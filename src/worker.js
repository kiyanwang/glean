#!/usr/bin/env node

import { writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import path from "path";
import os from "os";

import { getDb, closeDb } from "./db.js";
import { claimNextJob, completeJob, failJob, recoverStaleJobs } from "./queue.js";
import { summariseContent } from "./summarise.js";
import { generateNote } from "./note.js";
import { resolveUniqueFilename } from "./utils.js";
import { writeNote, updateIndex, deployBase, ensureFolder } from "./store.js";

const PID_FILE = path.join(os.homedir(), ".glean", "worker.pid");

/**
 * Write the current process PID to ~/.glean/worker.pid.
 */
function writePidFile() {
  writeFileSync(PID_FILE, String(process.pid), "utf-8");
}

/**
 * Remove the PID file on exit.
 */
function removePidFile() {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Send a macOS notification via osascript.
 *
 * @param {string} title - Notification title.
 * @param {string} message - Notification body.
 */
function notify(title, message) {
  try {
    const escaped = message.replace(/"/g, '\\"');
    execSync(
      `osascript -e 'display notification "${escaped}" with title "${title}"'`,
      { timeout: 5000 },
    );
  } catch {
    // Notification failure is non-fatal.
  }
}

/**
 * Process a single job: summarise, generate note, write to vault.
 *
 * @param {object} job - A full job row from the database.
 * @returns {{ path: string, filename: string }}
 */
async function processJob(job) {
  const extractedData = JSON.parse(job.extracted_data);
  const config = JSON.parse(job.config_snapshot);
  const cliOptions = JSON.parse(job.cli_options);
  const existingMeta = job.existing_meta ? JSON.parse(job.existing_meta) : null;
  const isUpdate = job.is_update === 1;
  const vaultPath = job.vault_path;
  const folder = job.folder;

  if (!existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  await ensureFolder(vaultPath, folder);

  // Step 1: Summarise content (this is the slow step).
  const summaryData = summariseContent(extractedData, config.model);

  // Step 2: Generate note.
  let parsedTags = cliOptions.tags || [];
  if (typeof parsedTags === "string") {
    parsedTags = parsedTags.split(",").map((t) => t.trim()).filter(Boolean);
  }

  const note = generateNote(summaryData, extractedData, {
    isUpdate,
    existingMeta,
    additionalTags: parsedTags,
    defaultTags: config.defaultTags || ["glean"],
    category: cliOptions.category || null,
  });

  // Step 3: Resolve filename.
  let finalFilename;
  if (isUpdate && job.existing_filename) {
    finalFilename = job.existing_filename;
  } else {
    finalFilename = await resolveUniqueFilename(note.filename, resolve(vaultPath, folder));
  }

  // Step 4: Write note to vault.
  const filePath = await writeNote(note.content, finalFilename, vaultPath, folder);
  await updateIndex(vaultPath, folder, job.url, finalFilename, note.frontmatter.gleaned, note.frontmatter.updated);
  await deployBase(vaultPath, folder);

  // Step 5: Open in Obsidian if requested.
  if (cliOptions.open && config.vault) {
    try {
      execSync(
        `open "obsidian://open?vault=${encodeURIComponent(config.vault)}&file=${encodeURIComponent(finalFilename)}"`,
      );
    } catch {
      // Non-fatal.
    }
  }

  return { path: filePath, filename: finalFilename };
}

/**
 * Main worker loop. Processes jobs until the queue is empty.
 */
async function main() {
  getDb();

  writePidFile();

  const recovered = recoverStaleJobs();
  if (recovered > 0) {
    process.stderr.write(`Recovered ${recovered} stale job(s).\n`);
  }

  let processedCount = 0;

  while (true) {
    const job = claimNextJob();

    if (!job) {
      break;
    }

    try {
      const result = await processJob(job);
      completeJob(job.id, result.path, result.filename);
      processedCount++;

      const extractedData = JSON.parse(job.extracted_data);
      const title = extractedData.title || "Article";
      notify("Glean", `Note ready: ${title}`);
    } catch (error) {
      const message = error.message || String(error);
      failJob(job.id, message);
      process.stderr.write(`Job ${job.id} failed: ${message}\n`);
    }
  }

  removePidFile();
  closeDb();

  if (processedCount > 0) {
    process.stderr.write(`Worker finished. Processed ${processedCount} job(s).\n`);
  }
}

// Run the worker.
main().catch((err) => {
  process.stderr.write(`Worker fatal error: ${err.message}\n`);
  removePidFile();
  closeDb();
  process.exit(1);
});

// Exported for testing.
export { processJob, main, writePidFile, removePidFile, notify, PID_FILE };
