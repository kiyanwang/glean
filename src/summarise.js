import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { truncateContent } from "./utils.js";

/**
 * Map of shorthand model names to full Anthropic model IDs.
 */
export const MODEL_MAP = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

/**
 * Zod schema describing the structured summary the API must return.
 */
export const ArticleSummarySchema = z.object({
  title: z.string(),
  author: z.string(),
  source: z.string(),
  published: z.string(),
  summary: z.string(),
  keyTakeaways: z.array(z.string()),
  topics: z.array(z.string()),
  category: z.enum([
    "engineering-management",
    "tools-and-libraries",
    "ai",
    "software-engineering",
    "leadership",
    "devops",
    "architecture",
    "career",
    "other",
  ]),
  readingTimeMinutes: z.number(),
  sentiment: z.enum([
    "informative",
    "opinion",
    "tutorial",
    "case-study",
    "research",
    "news",
  ]),
});

/**
 * Build the prompt string sent to the Anthropic API for summarisation.
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
 * Summarise extracted article content using the Anthropic API with structured outputs.
 *
 * @param {object} extractedData - The object returned by extractContent.
 * @param {string} [model='haiku'] - Model shorthand or full model ID.
 * @returns {Promise<object>} Parsed structured summary.
 */
export async function summariseContent(extractedData, model = "haiku") {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. Get your key at https://console.anthropic.com/",
    );
  }

  const resolvedModel = MODEL_MAP[model] || model;
  const prompt = buildPrompt(extractedData);

  const client = new Anthropic();

  let response;
  try {
    response = await client.messages.parse({
      model: resolvedModel,
      max_tokens: 4096,
      system:
        "You are a knowledge curator. Generate a structured summary of the given article.",
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(ArticleSummarySchema) },
    });
  } catch (err) {
    throw new Error(`Anthropic API request failed: ${err.message}`, {
      cause: err,
    });
  }

  const summary = response.parsed_output;

  if (!summary) {
    throw new Error(
      "Anthropic API returned no parsed output. The response may have failed validation.",
    );
  }

  return summary;
}
