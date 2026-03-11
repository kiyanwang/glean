import crypto from "crypto";
import { getDb } from "./db.js";
import { normaliseUrl } from "./utils.js";

/**
 * Insert a new job into the queue.
 *
 * @param {string} url - The article URL.
 * @param {object} extractedData - Result from extractContent().
 * @param {object} config - Merged config snapshot.
 * @param {object} options - CLI options (tags, category, model, open, etc.).
 * @param {object} [updateContext] - Update context if this is a re-glean.
 * @param {boolean} updateContext.isUpdate
 * @param {object|null} updateContext.existingMeta
 * @param {string|null} updateContext.existingFilename
 * @returns {{ id: string, url: string, status: string, created_at: string }}
 */
export function enqueueJob(url, extractedData, config, options, updateContext = {}) {
  const db = getDb();
  const id = crypto.randomUUID();

  const stmt = db.prepare(`
    INSERT INTO jobs (id, url, extracted_data, cli_options, config_snapshot,
                      vault_path, folder, is_update, existing_meta, existing_filename)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    url,
    JSON.stringify(extractedData),
    JSON.stringify(options),
    JSON.stringify(config),
    config.vaultPath,
    config.folder || "",
    updateContext.isUpdate ? 1 : 0,
    updateContext.existingMeta ? JSON.stringify(updateContext.existingMeta) : null,
    updateContext.existingFilename || null,
  );

  return db.prepare("SELECT id, url, status, created_at FROM jobs WHERE id = ?").get(id);
}

/**
 * Atomically claim the oldest pending job for processing.
 * Uses BEGIN EXCLUSIVE to prevent race conditions if multiple workers exist.
 *
 * @returns {object|null} Full job row, or null if queue is empty.
 */
export function claimNextJob() {
  const db = getDb();

  const claim = db.transaction(() => {
    const job = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get();

    if (!job) return null;

    db.prepare(`
      UPDATE jobs
      SET status = 'processing',
          started_at = datetime('now'),
          attempts = attempts + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(job.id);

    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id);
  });

  return claim.exclusive();
}

/**
 * Mark a job as completed with its result.
 *
 * @param {string} id - Job ID.
 * @param {string} resultPath - Absolute path to the written note file.
 * @param {string} resultFilename - Final filename (no extension).
 */
export function completeJob(id, resultPath, resultFilename) {
  const db = getDb();
  db.prepare(`
    UPDATE jobs
    SET status = 'completed',
        result_path = ?,
        result_filename = ?,
        completed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(resultPath, resultFilename, id);
}

/**
 * Mark a job as failed. If attempts < max_attempts, reset to pending for retry.
 * If attempts >= max_attempts, mark as permanently failed.
 *
 * @param {string} id - Job ID.
 * @param {string} errorMessage - Description of the error.
 */
export function failJob(id, errorMessage) {
  const db = getDb();
  const job = db.prepare("SELECT attempts, max_attempts FROM jobs WHERE id = ?").get(id);

  if (!job) return;

  if (job.attempts < job.max_attempts) {
    db.prepare(`
      UPDATE jobs
      SET status = 'pending',
          error_message = ?,
          started_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(errorMessage, id);
  } else {
    db.prepare(`
      UPDATE jobs
      SET status = 'failed',
          error_message = ?,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(errorMessage, id);
  }
}

/**
 * Get a single job by ID.
 *
 * @param {string} id - Job ID.
 * @returns {object|null}
 */
export function getJobById(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) || null;
}

/**
 * Get a summary of the queue: counts by status and recent items.
 *
 * @returns {{ counts: object, recent: object[] }}
 */
export function getJobSummary() {
  const db = getDb();

  const counts = {};
  const rows = db.prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status").all();
  for (const row of rows) {
    counts[row.status] = row.count;
  }

  const recent = db.prepare(`
    SELECT id, url, status, error_message, created_at, completed_at, result_filename
    FROM jobs
    ORDER BY created_at DESC
    LIMIT 20
  `).all();

  return { counts, recent };
}

/**
 * Get all jobs, optionally filtered by status.
 *
 * @param {string} [status] - Filter by status (pending, processing, completed, failed).
 * @returns {object[]}
 */
export function getAllJobs(status) {
  const db = getDb();
  if (status) {
    return db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC").all(status);
  }
  return db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
}

/**
 * Check if a pending or processing job already exists for this URL.
 *
 * @param {string} url - The article URL.
 * @returns {object|null} Existing job, or null.
 */
export function findPendingJobByUrl(url) {
  const db = getDb();
  const normUrl = normaliseUrl(url);

  const jobs = db.prepare("SELECT * FROM jobs WHERE status IN ('pending', 'processing')").all();

  for (const job of jobs) {
    try {
      if (normaliseUrl(job.url) === normUrl) {
        return job;
      }
    } catch {
      // Skip jobs with invalid URLs.
    }
  }

  return null;
}

/**
 * Reset a failed job to pending with attempts reset to 0.
 *
 * @param {string} id - Job ID.
 * @returns {boolean} True if the job was reset.
 */
export function retryJob(id) {
  const db = getDb();
  const result = db.prepare(`
    UPDATE jobs
    SET status = 'pending',
        attempts = 0,
        error_message = NULL,
        started_at = NULL,
        completed_at = NULL,
        updated_at = datetime('now')
    WHERE id = ? AND status = 'failed'
  `).run(id);

  return result.changes > 0;
}

/**
 * Reset all failed jobs to pending.
 *
 * @returns {number} Number of jobs reset.
 */
export function retryAllFailed() {
  const db = getDb();
  const result = db.prepare(`
    UPDATE jobs
    SET status = 'pending',
        attempts = 0,
        error_message = NULL,
        started_at = NULL,
        completed_at = NULL,
        updated_at = datetime('now')
    WHERE status = 'failed'
  `).run();

  return result.changes;
}

/**
 * Delete jobs from the queue.
 *
 * @param {'completed'|'failed'|'all'} filter - Which jobs to delete.
 * @returns {number} Number of jobs deleted.
 */
export function clearJobs(filter) {
  const db = getDb();

  if (filter === "all") {
    return db.prepare("DELETE FROM jobs").run().changes;
  }

  if (filter === "failed") {
    return db.prepare("DELETE FROM jobs WHERE status = 'failed'").run().changes;
  }

  // Default: clear completed and failed.
  return db.prepare("DELETE FROM jobs WHERE status IN ('completed', 'failed')").run().changes;
}

/**
 * Find jobs stuck in 'processing' status (e.g. worker crashed) and reset them.
 *
 * @returns {number} Number of jobs recovered.
 */
export function recoverStaleJobs() {
  const db = getDb();

  const stale = db.prepare("SELECT * FROM jobs WHERE status = 'processing'").all();
  let recovered = 0;

  for (const job of stale) {
    if (job.attempts < job.max_attempts) {
      db.prepare(`
        UPDATE jobs
        SET status = 'pending',
            started_at = NULL,
            error_message = 'Recovered from stale processing state',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(job.id);
    } else {
      db.prepare(`
        UPDATE jobs
        SET status = 'failed',
            error_message = 'Exceeded max attempts (recovered from stale state)',
            completed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(job.id);
    }
    recovered++;
  }

  return recovered;
}
