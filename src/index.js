import { resolve } from 'path';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import readline from 'readline/promises';
import path from 'path';
import os from 'os';

import { loadConfig } from './config.js';
import { validateUrl, resolveUniqueFilename } from './utils.js';
import { ensureFolder, findExistingNote, readExistingMeta, writeNote, updateIndex, deployBase } from './store.js';
import { extractContent } from './extract.js';
import { summariseContent } from './summarise.js';
import { generateNote } from './note.js';
import { composeTweet, openTweetIntent } from './tweet.js';

// Existing glean() function — unchanged.
export async function glean(url, options = {}) {
  // 1. Load config (merge CLI options over config file values)
  const fileConfig = await loadConfig(options.config);
  const config = { ...fileConfig, ...stripUndefined(options) };

  const vaultPath = config.vaultPath;
  const folder = config.folder || '';
  const outputOnly = options.dryRun || options.json;

  // 2. Validate URL
  if (!validateUrl(url)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  // 3. Check for existing note (skip for output-only modes without a vault)
  let existingMeta = null;
  let isUpdate = false;
  let existing = null;

  if (vaultPath) {
    await ensureFolder(vaultPath, folder);
    existing = await findExistingNote(url, vaultPath, folder);

    if (existing) {
      if (!options.update) {
        if (!process.stdin.isTTY) {
          throw new Error('Note already exists for this URL. Use --update to refresh.');
        }

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
        });

        const answer = await rl.question('A note already exists for this URL. Update it? (y/N) ');
        rl.close();

        if (answer.trim().toLowerCase() !== 'y') {
          throw new Error('Aborted');
        }
      }

      existingMeta = await readExistingMeta(resolve(vaultPath, folder, existing.filename + '.md'));
      isUpdate = true;
    }
  } else if (!outputOnly) {
    throw new Error(
      'No vault path configured. Set "vaultPath" in your config file or pass --vault-path on the CLI.'
    );
  }

  // 4. Extract content
  console.error(`Extracting content from ${url}...`);
  const extractedData = await extractContent(url);

  // 5. Summarise content
  console.error('Generating summary...');
  const summaryData = await summariseContent(extractedData, config.model);

  // 6. Generate note
  let parsedTags = options.tags || [];
  if (typeof parsedTags === 'string') {
    parsedTags = parsedTags.split(',').map((t) => t.trim()).filter(Boolean);
  }

  const note = await generateNote(summaryData, extractedData, {
    isUpdate,
    existingMeta: existingMeta || null,
    additionalTags: parsedTags,
    defaultTags: config.defaultTags,
    category: options.category || null,
  });

  // 7. Build tweet text (used by multiple output modes)
  const tweetText = options.tweet
    ? composeTweet(summaryData.tweetSummary, url, summaryData.title)
    : null;

  // 8. Handle output modes
  if (options.dryRun) {
    console.log(note.content);
    if (tweetText) {
      console.error(`Tweet: ${tweetText}`);
    }
    return { dryRun: true, content: note.content, tweet: tweetText };
  }

  if (options.json) {
    const output = { frontmatter: note.frontmatter, filename: note.filename };
    if (tweetText) {
      output.tweet = tweetText;
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // 8. Store note
  let finalFilename;
  if (isUpdate) {
    finalFilename = existing.filename;
  } else {
    finalFilename = await resolveUniqueFilename(note.filename, resolve(vaultPath, folder));
  }

  const filePath = await writeNote(note.content, finalFilename, vaultPath, folder);
  await updateIndex(vaultPath, folder, url, finalFilename, note.frontmatter.gleaned, note.frontmatter.updated);
  await deployBase(vaultPath, folder);

  // 10. Open in Obsidian (if --open)
  if (options.open) {
    execSync(`open "obsidian://open?vault=${encodeURIComponent(config.vault)}&file=${encodeURIComponent(finalFilename)}"`);
  }

  // 11. Open tweet intent (if --tweet)
  if (tweetText) {
    console.error(`Tweet: ${tweetText}`);
    openTweetIntent(tweetText);
  }

  // 12. Return result
  return { path: filePath, filename: finalFilename, isUpdate, title: note.frontmatter.title };
}

/**
 * Async pipeline: extract content, enqueue job, spawn worker, return immediately.
 *
 * @param {string} url - Article URL.
 * @param {object} options - CLI options.
 */
export async function gleanAsync(url, options = {}) {
  // 1. Load config (same as synchronous path).
  const fileConfig = await loadConfig(options.config);
  const config = { ...fileConfig, ...stripUndefined(options) };

  const vaultPath = config.vaultPath;
  const folder = config.folder || '';

  // 2. Validate URL.
  if (!validateUrl(url)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  // 3. Validate vault path.
  if (!vaultPath) {
    throw new Error(
      'No vault path configured. Set "vaultPath" in your config file or pass --vault-path on the CLI.',
    );
  }

  // 4. Check for existing note (interactive prompt if needed — must happen before enqueue).
  let existingMeta = null;
  let isUpdate = false;
  let existingFilename = null;

  await ensureFolder(vaultPath, folder);
  const existing = await findExistingNote(url, vaultPath, folder);

  if (existing) {
    if (!options.update) {
      if (!process.stdin.isTTY) {
        throw new Error('Note already exists for this URL. Use --update to refresh.');
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });

      const answer = await rl.question('A note already exists for this URL. Update it? (y/N) ');
      rl.close();

      if (answer.trim().toLowerCase() !== 'y') {
        throw new Error('Aborted');
      }
    }

    existingMeta = await readExistingMeta(resolve(vaultPath, folder, existing.filename + '.md'));
    isUpdate = true;
    existingFilename = existing.filename;
  }

  // 5. Extract content (1-3 seconds — acceptable to do synchronously).
  console.error(`Extracting content from ${url}...`);
  const extractedData = await extractContent(url);

  // 6. Check for duplicate pending job.
  const { findPendingJobByUrl, enqueueJob } = await import('./queue.js');
  const duplicateJob = findPendingJobByUrl(url);
  if (duplicateJob) {
    console.error(`A job for this URL is already queued (${duplicateJob.id.slice(0, 8)}).`);
    console.error(`Check status with: glean status ${duplicateJob.id}`);
    return;
  }

  // 7. Enqueue job.
  const job = enqueueJob(url, extractedData, config, options, {
    isUpdate,
    existingMeta,
    existingFilename,
  });

  // 8. Spawn worker if not already running.
  spawnWorker();

  // 9. Print confirmation.
  const title = extractedData.title || url;
  console.error(`Queued: ${title}`);
  console.error(`Job ID: ${job.id}`);
  console.error('Summarisation will complete in the background.');
  console.error(`Check status with: glean status ${job.id}`);
}

/**
 * Spawn a detached background worker process to drain the job queue.
 * No-op if a worker is already running (based on PID file check).
 */
export function spawnWorker() {
  const pidFile = path.join(os.homedir(), '.glean', 'worker.pid');

  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      // Signal 0 = existence check, doesn't kill.
      process.kill(pid, 0);
      // Process is alive — do not spawn another worker.
      return;
    } catch {
      // Process is not running — stale PID file. Continue to spawn.
    }
  }

  const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url));

  const child = spawn(process.execPath, [workerPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
