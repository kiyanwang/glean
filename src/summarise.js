import { spawnSync } from "child_process";
import { truncateContent } from "./utils.js";

/**
 * Map of valid model shorthand names accepted by the Claude CLI.
 */
export const MODEL_MAP = {
  haiku: "haiku",
  sonnet: "sonnet",
  opus: "opus",
};

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
    tweetSummary: { type: "string" },
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
- sentiment: One of: informative, opinion, tutorial, case-study, research, news
- tweetSummary: A compelling summary of the article (maximum 2000 characters, no hashtags, no URL — the URL will be appended automatically)`;
}

/**
 * Summarise extracted article content using the Claude CLI.
 *
 * @param {object} extractedData - The object returned by extractContent.
 * @param {string} [model='haiku'] - Model shorthand or full name for the Claude CLI.
 * @returns {object} Parsed structured summary.
 */
export function summariseContent(extractedData, model = "haiku") {
  const prompt = buildPrompt(extractedData);
  const resolvedModel = MODEL_MAP[model] || model;

  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const args = [
    "-p",
    "--model",
    resolvedModel,
    "--output-format",
    "json",
    "--json-schema",
    summarySchema,
  ];

  const result = spawnSync("claude", args, {
    input: prompt,
    encoding: "utf-8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    env,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        "Claude CLI not found. Install it from https://claude.ai/download",
        { cause: result.error },
      );
    }
    throw new Error(
      `Claude CLI failed: ${result.error.message || String(result.error)}`,
      { cause: result.error },
    );
  }

  if (result.signal === "SIGTERM") {
    throw new Error("Claude CLI timed out");
  }

  if (result.status !== 0) {
    throw new Error(
      `Claude CLI failed: ${result.stderr || `exit code ${result.status}`}`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(
      `Failed to parse Claude CLI response as JSON: ${err.message}`,
      { cause: err },
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
}
