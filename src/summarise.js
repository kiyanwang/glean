import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { truncateContent } from "./utils.js";

/**
 * JSON schema describing the structured summary Claude must return.
 */
const summarySchema = JSON.stringify({
  type: "object",
  properties: {
    title: { type: "string" },
    author: { type: "string" },
    source: { type: "string" },
    published: { type: "string" },
    summary: { type: "string" },
    keyTakeaways: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    category: {
      type: "string",
      enum: [
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
    },
    readingTimeMinutes: { type: "number" },
    sentiment: {
      type: "string",
      enum: [
        "informative",
        "opinion",
        "tutorial",
        "case-study",
        "research",
        "news",
      ],
    },
  },
  required: [
    "title",
    "author",
    "source",
    "published",
    "summary",
    "keyTakeaways",
    "topics",
    "category",
    "readingTimeMinutes",
    "sentiment",
  ],
});

/**
 * Required fields that must be present in the parsed summary.
 */
const REQUIRED_FIELDS = [
  "title",
  "author",
  "source",
  "published",
  "summary",
  "keyTakeaways",
  "topics",
  "category",
  "readingTimeMinutes",
  "sentiment",
];

/**
 * Build the prompt string sent to Claude for summarisation.
 *
 * @param {object} data - Extracted article data from extractContent.
 * @returns {string}
 */
function buildPrompt(data) {
  const content = truncateContent(data.content, 100000);

  return `You are a knowledge curator. Given the following article content, generate a structured summary.

Article URL: ${data.url}
Article Title: ${data.title}
Article Author: ${data.author}
Publication Date: ${data.published}
Source Site: ${data.site}
Word Count: ${data.wordCount}

--- Article Content ---
${content}
--- End Content ---

Generate a structured summary with the following fields:
- title: The article title (clean it up if needed)
- author: The author name(s)
- source: The publication or website name
- published: The publication date in YYYY-MM-DD format (or empty string if unknown)
- summary: A concise 2-3 paragraph summary of the article's main points
- keyTakeaways: 3-5 bullet points of the most important insights
- topics: 3-7 topic tags relevant to the content (lowercase, hyphenated)
- category: One of: engineering-management, tools-and-libraries, ai, software-engineering, leadership, devops, architecture, career, other
- readingTimeMinutes: Estimated reading time of the original article
- sentiment: One of: informative, opinion, tutorial, case-study, research, news`;
}

/**
 * Summarise extracted article content using the Claude CLI.
 *
 * @param {object} extractedData - The object returned by extractContent.
 * @returns {object} Parsed structured summary.
 */
export function summariseContent(extractedData) {
  const prompt = buildPrompt(extractedData);

  // Write the prompt to a temporary file so we can pipe it to the CLI.
  const tmpFile = join(
    tmpdir(),
    `glean-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );

  try {
    writeFileSync(tmpFile, prompt, "utf-8");

    const command = `claude -p --model sonnet --output-format json --json-schema '${summarySchema}' < "${tmpFile}"`;

    let output;
    try {
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;
      output = execSync(command, {
        encoding: "utf-8",
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        env,
        shell: true,
      });
    } catch (err) {
      if (err.code === "ENOENT" || (err.message && err.message.includes("ENOENT"))) {
        throw new Error(
          "Claude CLI not found. Install it from https://claude.ai/download",
        );
      }
      if (err.killed || (err.signal && err.signal === "SIGTERM")) {
        throw new Error("Claude CLI timed out");
      }
      throw new Error(
        `Claude CLI failed: ${err.stderr || err.message || String(err)}`,
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (err) {
      throw new Error(
        `Failed to parse Claude CLI response as JSON: ${err.message}`,
      );
    }

    // Claude CLI --output-format json returns an envelope with the summary in
    // `structured_output` (when --json-schema is used) or `result` (as a JSON string).
    if (parsed.structured_output && typeof parsed.structured_output === "object") {
      parsed = parsed.structured_output;
    } else if (parsed.result !== undefined && typeof parsed.result === "string" && parsed.result.trim()) {
      try {
        parsed = JSON.parse(parsed.result);
      } catch {
        // fall through to validation which will report missing fields
      }
    }

    const missing = REQUIRED_FIELDS.filter(
      (field) => !(field in parsed),
    );
    if (missing.length > 0) {
      throw new Error(
        `Summary is missing required fields: ${missing.join(", ")}`,
      );
    }

    return parsed;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors.
    }
  }
}
