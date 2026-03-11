import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import path from "path";
import os from "os";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".glean", "glean.db");

let _instance = null;
let _instancePath = null;

/**
 * Open (or return existing) SQLite database connection.
 * Creates the ~/.glean/ directory and runs schema migration if needed.
 *
 * @param {string} [dbPath] - Override database path. Use ':memory:' for tests.
 *   Defaults to ~/.glean/glean.db.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb(dbPath) {
  const resolvedPath = dbPath || DEFAULT_DB_PATH;

  // If a singleton exists and no explicit path was requested, reuse it.
  // This allows tests to initialise with ':memory:' and have all subsequent
  // getDb() calls (without args) in queue.js/worker.js use the same instance.
  if (_instance && !dbPath) {
    return _instance;
  }

  if (_instance && _instancePath === resolvedPath) {
    return _instance;
  }

  // Ensure parent directory exists (skip for :memory:).
  if (resolvedPath !== ":memory:") {
    const dir = path.dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(resolvedPath);

  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  _instance = db;
  _instancePath = resolvedPath;

  return db;
}

/**
 * Close the singleton database connection. Useful for clean test teardown.
 */
export function closeDb() {
  if (_instance) {
    _instance.close();
    _instance = null;
    _instancePath = null;
  }
}

export { DEFAULT_DB_PATH };

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,
  url               TEXT NOT NULL,
  extracted_data    TEXT NOT NULL,
  cli_options       TEXT NOT NULL DEFAULT '{}',
  config_snapshot   TEXT NOT NULL DEFAULT '{}',
  vault_path        TEXT NOT NULL,
  folder            TEXT NOT NULL DEFAULT '',
  is_update         INTEGER NOT NULL DEFAULT 0,
  existing_meta     TEXT,
  existing_filename TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  result_path       TEXT,
  result_filename   TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  completed_at      TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created
  ON jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_url_status
  ON jobs (url, status);
`;
