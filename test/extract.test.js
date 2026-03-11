import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureData = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-defuddle-output.json"), "utf-8"),
);

// --- Mocks -------------------------------------------------------------------

vi.mock("jsdom", () => {
  const fromURL = vi.fn();
  return {
    JSDOM: { fromURL },
  };
});

vi.mock("defuddle/node", () => {
  const Defuddle = vi.fn();
  return { Defuddle };
});

// Import after mocks are declared so vi.mock hoisting takes effect.
const { JSDOM } = await import("jsdom");
const { Defuddle } = await import("defuddle/node");
const { extractContent } = await import("../src/extract.js");

// --- Helpers -----------------------------------------------------------------

function stubDefuddle(result) {
  const fakeDom = { serialize: () => '<html></html>' };
  JSDOM.fromURL.mockResolvedValue(fakeDom);
  Defuddle.mockResolvedValue(result);
}

// --- Tests -------------------------------------------------------------------

describe("extractContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid defuddle output", async () => {
    stubDefuddle(fixtureData);

    const result = await extractContent("https://martinfowler.com/articles/platform-prerequisites.html");

    expect(result.content).toBe(fixtureData.content);
    expect(result.title).toBe(fixtureData.title);
    expect(result.description).toBe(fixtureData.description);
    expect(result.domain).toBe(fixtureData.domain);
    expect(result.author).toBe(fixtureData.author);
    expect(result.site).toBe(fixtureData.site);
    expect(result.published).toBe(fixtureData.published);
    expect(result.wordCount).toBe(fixtureData.wordCount);
    expect(result.language).toBe(fixtureData.language);
    expect(result.favicon).toBe(fixtureData.favicon);
    expect(result.image).toBe(fixtureData.image);
    expect(result.url).toBe("https://martinfowler.com/articles/platform-prerequisites.html");
  });

  it("handles missing optional fields", async () => {
    stubDefuddle({
      content: "Some article content here.",
      title: "A Title",
      // all other fields are undefined
    });

    const result = await extractContent("https://example.com/article");

    expect(result.content).toBe("Some article content here.");
    expect(result.title).toBe("A Title");
    expect(result.author).toBe("");
    expect(result.published).toBe("");
    expect(result.description).toBe("");
    expect(result.domain).toBe("");
    expect(result.site).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.language).toBe("en");
    expect(result.favicon).toBe("");
    expect(result.image).toBe("");
  });

  it("rejects empty content", async () => {
    stubDefuddle({ content: "" });

    await expect(
      extractContent("https://example.com/empty"),
    ).rejects.toThrow("No extractable content found");
  });

  it("rejects null response", async () => {
    stubDefuddle(null);

    await expect(
      extractContent("https://example.com/null"),
    ).rejects.toThrow("No extractable content found");
  });

  it("validates URL format", async () => {
    await expect(extractContent("not-a-url")).rejects.toThrow("Invalid URL");
  });
});
