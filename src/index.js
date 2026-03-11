import { resolve } from 'path';
import { execSync } from 'child_process';
import readline from 'readline/promises';

import { loadConfig } from './config.js';
import { validateUrl, resolveUniqueFilename } from './utils.js';
import { ensureFolder, findExistingNote, readExistingMeta, writeNote, updateIndex, deployBase } from './store.js';
import { extractContent } from './extract.js';
import { summariseContent } from './summarise.js';
import { generateNote } from './note.js';

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

  // 7. Handle output modes
  if (options.dryRun) {
    console.log(note.content);
    return { dryRun: true, content: note.content };
  }

  if (options.json) {
    console.log(JSON.stringify({ frontmatter: note.frontmatter, filename: note.filename }, null, 2));
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

  // 9. Open in Obsidian (if --open)
  if (options.open) {
    execSync(`open "obsidian://open?vault=${encodeURIComponent(config.vault)}&file=${encodeURIComponent(finalFilename)}"`);
  }

  // 10. Return result
  return { path: filePath, filename: finalFilename, isUpdate, title: note.frontmatter.title };
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
