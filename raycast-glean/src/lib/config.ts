import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { GleanConfig } from "./types";

const CONFIG_PATH = path.join(homedir(), ".gleanrc.json");

const DEFAULTS: GleanConfig = {
  vault: "Knowledge Base",
  vaultPath: null,
  folder: "Glean",
  defaultTags: ["glean"],
  model: "haiku",
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

let _cached: GleanConfig | null = null;

/**
 * Load glean configuration from ~/.gleanrc.json, merged with defaults.
 * Result is cached for the lifetime of the extension process.
 */
export function loadGleanConfig(): GleanConfig {
  if (_cached) return _cached;

  let userConfig: Partial<GleanConfig> = {};
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    userConfig = JSON.parse(raw);
  } catch {
    // File missing or invalid — use defaults.
  }

  _cached = { ...DEFAULTS, ...userConfig };
  return _cached;
}
