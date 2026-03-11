import { readFile, access } from "fs/promises";
import { constants } from "fs";
import path from "path";
import os from "os";

const DEFAULTS = {
  vault: "Knowledge Base",
  vaultPath: null,
  folder: "Glean",
  defaultTags: ["glean"],
  model: "haiku",
  dbPath: path.join(os.homedir(), ".glean", "glean.db"),
  categories: [
    "engineering-management",
    "tools-and-libraries",
    "ai",
    "software-engineering",
    "leadership",
    "devops",
    "architecture",
    "career",
    "other",
  ],
};

/**
 * Load configuration from a JSON file, merging with defaults.
 *
 * @param {string} [customPath] - Optional path to a config file.
 *   Falls back to ~/.gleanrc.json when omitted.
 * @returns {Promise<object>} The merged configuration object.
 */
export async function loadConfig(customPath) {
  const configPath = customPath || path.join(os.homedir(), ".gleanrc.json");

  let userConfig = {};

  try {
    const raw = await readFile(configPath, "utf-8");
    userConfig = JSON.parse(raw);
  } catch (err) {
    // File missing or unreadable — fall through to defaults.
    if (err.code !== "ENOENT") {
      // For unexpected errors (bad JSON, permission denied, etc.) we still
      // fall back to defaults but let the caller know something was off.
      console.error(`Warning: could not load config from ${configPath}: ${err.message}`);
    }
  }

  const merged = { ...DEFAULTS, ...userConfig };

  // Validate that vaultPath exists on disk when provided.
  if (merged.vaultPath) {
    try {
      await access(merged.vaultPath, constants.R_OK);
    } catch {
      console.error(
        `Warning: configured vaultPath "${merged.vaultPath}" does not exist or is not readable`,
      );
    }
  }

  return merged;
}
