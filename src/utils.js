import { access } from "fs/promises";
import path from "path";

/**
 * Return true when `url` is a valid http or https URL.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function validateUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Convert an article title into a filesystem-safe filename.
 *
 * - Spaces become hyphens
 * - Special characters (anything not alphanumeric or hyphen) are removed
 * - Result is lowercased
 * - Truncated to 80 characters at a word boundary when possible
 * - No file extension is appended
 *
 * @param {string} title
 * @returns {string}
 */
export function sanitiseFilename(title) {
  let name = title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  if (name.length > 80) {
    // Try to truncate at a word (hyphen) boundary.
    const truncated = name.slice(0, 80);
    const lastHyphen = truncated.lastIndexOf("-");
    name = lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
  }

  return name;
}

/**
 * Ensure the filename is unique inside `folder`.
 *
 * Checks for `<folder>/<baseName>.md`. If it exists, tries
 * `<baseName>-2.md`, `<baseName>-3.md`, etc.
 *
 * @param {string} baseName - Filename without extension.
 * @param {string} folder   - Directory to check in.
 * @returns {Promise<string>} A unique baseName (no extension).
 */
export async function resolveUniqueFilename(baseName, folder) {
  let candidate = baseName;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const filePath = path.join(folder, `${candidate}.md`);
    try {
      await access(filePath);
      // File exists — bump counter and try again.
      counter += 1;
      candidate = `${baseName}-${counter}`;
    } catch {
      // File does not exist — this name is available.
      return candidate;
    }
  }
}

/**
 * Normalise a URL for comparison purposes.
 *
 * - Lowercases scheme and host
 * - Removes trailing slash from pathname
 * - Strips the fragment (hash)
 *
 * @param {string} url
 * @returns {string}
 */
export function normaliseUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";

  // Rebuild with lowercased scheme + host (URL constructor already lowercases
  // the host, but we make the intent explicit).
  let normalised = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname}`;

  // Remove a single trailing slash (but keep "/" for root paths).
  if (normalised.endsWith("/") && parsed.pathname !== "/") {
    normalised = normalised.slice(0, -1);
  }

  // Re-append search params if present.
  if (parsed.search) {
    normalised += parsed.search;
  }

  return normalised;
}

/**
 * Format a Date as a `YYYY-MM-DD` string.
 *
 * @param {Date} [date] - Defaults to the current date.
 * @returns {string}
 */
export function formatDate(date) {
  const d = date instanceof Date ? date : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Truncate content to a maximum character length.
 *
 * When truncation occurs a notice is appended so downstream consumers know
 * the text was shortened.
 *
 * @param {string} content
 * @param {number} [maxChars=100000]
 * @returns {string}
 */
export function truncateContent(content, maxChars = 100000) {
  if (content.length <= maxChars) {
    return content;
  }
  return content.slice(0, maxChars) + "[Content truncated for length]";
}
