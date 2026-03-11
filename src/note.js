import yaml from "yaml";
import { sanitiseFilename, formatDate } from "./utils.js";

/**
 * Merge and deduplicate tag arrays, preserving order of first occurrence.
 *
 * @param  {...string[]} arrays - Tag arrays to merge.
 * @returns {string[]} Deduplicated tags.
 */
function mergeTags(...arrays) {
  const seen = new Set();
  const result = [];

  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const tag of arr) {
      const normalised = String(tag).trim().toLowerCase();
      if (normalised && !seen.has(normalised)) {
        seen.add(normalised);
        result.push(normalised);
      }
    }
  }

  return result;
}

/**
 * Build a complete Markdown note with YAML frontmatter from summary and
 * extraction data.
 *
 * @param {object} summaryData   - Structured summary returned by Claude.
 * @param {object} extractedData - Extraction result from Defuddle.
 * @param {object} options       - Generation options.
 * @param {boolean}       options.isUpdate       - Whether this updates an existing note.
 * @param {object|null}   options.existingMeta   - Existing YAML frontmatter when updating.
 * @param {string[]}      options.additionalTags - Tags supplied via --tags CLI flag.
 * @param {string[]}      options.defaultTags    - Tags from user config (default: ['glean']).
 * @param {string|null}   options.category       - Category override from --category CLI flag.
 * @returns {{ content: string, filename: string, frontmatter: object }}
 */
export function generateNote(summaryData, extractedData, options = {}) {
  const {
    isUpdate = false,
    existingMeta = null,
    additionalTags = [],
    defaultTags = ["glean"],
    category: categoryOverride = null,
  } = options;

  const today = formatDate(new Date());
  const category = categoryOverride || summaryData.category;

  // --- Frontmatter --------------------------------------------------------

  const tags = isUpdate
    ? mergeTags(
        defaultTags,
        additionalTags,
        [category],
        existingMeta?.tags ?? [],
      )
    : mergeTags(defaultTags, additionalTags, [category]);

  const frontmatter = {
    title: summaryData.title,
    author: summaryData.author,
    source: summaryData.source,
    url: extractedData.url,
    published: summaryData.published || "",
    gleaned: isUpdate && existingMeta?.gleaned ? existingMeta.gleaned : today,
    updated: today,
    category,
    sentiment: summaryData.sentiment,
    reading_time: summaryData.readingTimeMinutes,
    word_count: extractedData.wordCount,
    language: extractedData.language,
    topics: summaryData.topics ?? [],
    tags,
    key_takeaways: summaryData.keyTakeaways ?? [],
  };

  // --- YAML serialisation -------------------------------------------------

  const yamlString = yaml.stringify(frontmatter, {
    lineWidth: 0, // prevent line wrapping
  });

  const frontmatterBlock = `---\n${yamlString}---`;

  // --- Markdown body ------------------------------------------------------

  const takeawaysBullets = (summaryData.keyTakeaways ?? [])
    .map((t) => `- ${t}`)
    .join("\n");

  const authorPart = summaryData.author ? ` by ${summaryData.author}` : "";
  const sourcePart = summaryData.source ? ` on ${summaryData.source}` : "";

  const body = [
    "## Summary",
    "",
    summaryData.summary,
    "",
    "## Key Takeaways",
    "",
    takeawaysBullets,
    "",
    "## Source",
    "",
    `[${summaryData.title}](${extractedData.url})${authorPart}${sourcePart}`,
    "",
  ].join("\n");

  // --- Filename -----------------------------------------------------------

  let filename;
  if (isUpdate && existingMeta?.filename) {
    filename = existingMeta.filename;
  } else {
    filename = sanitiseFilename(summaryData.title);
  }

  // --- Assemble -----------------------------------------------------------

  const content = `${frontmatterBlock}\n\n${body}`;

  return { content, filename, frontmatter };
}
