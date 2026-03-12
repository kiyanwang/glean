/**
 * Parsed contents of the `extracted_data` JSON column.
 * Produced by glean's extraction step (Readability + metadata).
 */
export interface ExtractedData {
  title: string;
  url: string;
  content: string;
  wordCount: number;
  byline: string | null;
  siteName: string | null;
}

/**
 * A single row from the `jobs` table in glean's SQLite database.
 * See src/db.js SCHEMA_SQL for the authoritative column definitions.
 */
export interface Job {
  id: string;
  url: string;
  /** JSON string — parse with `JSON.parse()` to get {@link ExtractedData}. */
  extracted_data: string;
  /** JSON string of CLI options used when the job was enqueued. */
  cli_options: string;
  /** JSON string of resolved config at enqueue time. */
  config_snapshot: string;
  vault_path: string;
  folder: string;
  /** 0 = new note, 1 = re-glean / update of existing note. */
  is_update: number;
  existing_meta: string | null;
  existing_filename: string | null;
  /** One of: pending, processing, completed, failed. */
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
  /** Absolute path to the created/updated note file. */
  result_path: string | null;
  result_filename: string | null;
  error_message: string | null;
  /** ISO 8601 datetime string. */
  created_at: string;
  /** ISO 8601 datetime string. */
  started_at: string | null;
  /** ISO 8601 datetime string. */
  completed_at: string | null;
  /** ISO 8601 datetime string. */
  updated_at: string;
}

/**
 * Raycast extension preferences as declared in package.json.
 * Only contains Raycast-specific settings — all glean config comes from ~/.gleanrc.json.
 */
export interface GleanPreferences {
  /** Absolute path to the glean binary. Empty string means use PATH. */
  gleanPath: string;
}

/**
 * Shape of the ~/.gleanrc.json config file (merged with glean defaults).
 * Read at extension startup for UI purposes (form defaults, Obsidian URLs).
 */
export interface GleanConfig {
  vault: string;
  vaultPath: string | null;
  folder: string;
  defaultTags: string[];
  model: string;
  categories: string[];
}
