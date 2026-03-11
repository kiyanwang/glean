import { Defuddle } from "defuddle/node";
import { JSDOM } from "jsdom";
import { validateUrl } from "./utils.js";

/**
 * Extract and normalise article content from a URL using JSDOM and Defuddle.
 *
 * @param {string} url - The URL to extract content from.
 * @returns {Promise<object>} Normalised extraction result.
 */
export async function extractContent(url) {
  if (!validateUrl(url)) {
    throw new Error(`Invalid URL: ${url}`);
  }

  let dom;
  try {
    dom = await JSDOM.fromURL(url);
  } catch (err) {
    throw new Error(
      `Failed to fetch URL: ${url} — ${err.message || String(err)}`,
      { cause: err },
    );
  }

  let result;
  try {
    const html = dom.serialize();
    result = await Defuddle(html, url, { markdown: true });
  } catch (err) {
    throw new Error(
      `Content extraction failed for ${url} — ${err.message || String(err)}`,
      { cause: err },
    );
  }

  if (!result || !result.content || result.content.trim().length === 0) {
    throw new Error("No extractable content found");
  }

  return {
    content: result.content,
    title: result.title || "",
    description: result.description || "",
    domain: result.domain || "",
    author: result.author || "",
    site: result.site || "",
    published: result.published || "",
    wordCount: result.wordCount || 0,
    language: result.language || "en",
    favicon: result.favicon || "",
    image: result.image || "",
    url: url,
  };
}
