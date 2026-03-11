import { readFile, writeFile, mkdir, readdir, copyFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";
import { normaliseUrl } from "./utils.js";

/**
 * Write a Markdown note to the vault folder.
 *
 * @param {string} content   - Full Markdown content (frontmatter + body).
 * @param {string} filename  - Base filename without extension.
 * @param {string} vaultPath - Absolute path to the Obsidian vault.
 * @param {string} folder    - Sub-folder inside the vault (e.g. "Glean").
 * @returns {Promise<string>} The absolute path of the written file.
 */
export async function writeNote(content, filename, vaultPath, folder) {
  const filePath = path.join(vaultPath, folder, `${filename}.md`);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/**
 * Load the URL-to-file index, rebuilding it from disk when necessary.
 *
 * @param {string} vaultPath - Absolute path to the Obsidian vault.
 * @param {string} folder    - Sub-folder inside the vault.
 * @returns {Promise<object>} Map of normalised URL -> { filename, gleaned, updated }.
 */
export async function loadIndex(vaultPath, folder) {
  const indexPath = path.join(vaultPath, folder, ".glean-index.json");

  // Attempt to read an existing index file.
  try {
    const raw = await readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Missing or corrupt — fall through to rebuild.
  }

  // Rebuild index by scanning .md files in the folder.
  const folderPath = path.join(vaultPath, folder);
  const index = {};

  let entries;
  try {
    entries = await readdir(folderPath);
  } catch {
    // Folder doesn't exist yet — return empty index.
    return index;
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md"));

  for (const file of mdFiles) {
    try {
      const filePath = path.join(folderPath, file);
      const content = await readFile(filePath, "utf-8");
      const meta = parseFrontmatter(content);

      if (meta && meta.url) {
        const normUrl = normaliseUrl(meta.url);
        const filename = path.basename(file, ".md");
        index[normUrl] = {
          filename,
          gleaned: meta.gleaned || "",
          updated: meta.updated || "",
        };
      }
    } catch {
      // Skip files that can't be read or parsed.
    }
  }

  // Persist the rebuilt index.
  try {
    await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  } catch {
    // Non-fatal — the index will be rebuilt next time.
  }

  return index;
}

/**
 * Add or update an entry in the index and persist it to disk.
 *
 * @param {string} vaultPath - Absolute path to the Obsidian vault.
 * @param {string} folder    - Sub-folder inside the vault.
 * @param {string} url       - The article URL.
 * @param {string} filename  - Base filename without extension.
 * @param {string} gleaned   - Date the note was first created (YYYY-MM-DD).
 * @param {string} updated   - Date the note was last updated (YYYY-MM-DD).
 */
export async function updateIndex(vaultPath, folder, url, filename, gleaned, updated) {
  const index = await loadIndex(vaultPath, folder);
  const normUrl = normaliseUrl(url);

  index[normUrl] = { filename, gleaned, updated };

  const indexPath = path.join(vaultPath, folder, ".glean-index.json");
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

/**
 * Look up a URL in the index to see if it has already been gleaned.
 *
 * @param {string} url       - The article URL to search for.
 * @param {string} vaultPath - Absolute path to the Obsidian vault.
 * @param {string} folder    - Sub-folder inside the vault.
 * @returns {Promise<{ filename: string, gleaned: string, updated: string } | null>}
 */
export async function findExistingNote(url, vaultPath, folder) {
  const index = await loadIndex(vaultPath, folder);
  const normUrl = normaliseUrl(url);

  // Direct lookup first.
  if (index[normUrl]) {
    return index[normUrl];
  }

  // Compare normalised forms in case the stored keys aren't normalised.
  for (const [storedUrl, entry] of Object.entries(index)) {
    try {
      if (normaliseUrl(storedUrl) === normUrl) {
        return entry;
      }
    } catch {
      // Skip entries with invalid URLs.
    }
  }

  return null;
}

/**
 * Read and parse YAML frontmatter from an existing Markdown note.
 *
 * @param {string} filePath - Absolute path to the .md file.
 * @returns {Promise<object>} Parsed frontmatter object.
 */
export async function readExistingMeta(filePath) {
  const content = await readFile(filePath, "utf-8");
  return parseFrontmatter(content);
}

/**
 * Create the vault sub-folder if it does not already exist.
 *
 * @param {string} vaultPath - Absolute path to the Obsidian vault.
 * @param {string} folder    - Sub-folder inside the vault.
 */
export async function ensureFolder(vaultPath, folder) {
  await mkdir(path.join(vaultPath, folder), { recursive: true });
}

/**
 * Copy the Glean.base template into the vault folder when it is not already
 * present.
 *
 * @param {string} vaultPath - Absolute path to the Obsidian vault.
 * @param {string} folder    - Sub-folder inside the vault.
 */
export async function deployBase(vaultPath, folder) {
  const destPath = path.join(vaultPath, folder, "Glean.base");

  try {
    await readFile(destPath);
    // File already exists — nothing to do.
    return;
  } catch {
    // File missing — proceed to copy.
  }

  // Resolve the template relative to *this* source file, which lives at
  // <project>/src/store.js. The template is at <project>/templates/base.yaml.
  const thisFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(thisFile), "..");
  const templatePath = path.join(projectRoot, "templates", "base.yaml");

  await copyFile(templatePath, destPath);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the YAML block between the first pair of `---` delimiters and parse
 * it.
 *
 * @param {string} content - Full file content.
 * @returns {object|null} Parsed object, or null if no frontmatter found.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  try {
    return yaml.parse(match[1]);
  } catch {
    return null;
  }
}
