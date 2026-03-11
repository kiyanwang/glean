import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import yaml from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const claudeResponse = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-claude-response.json"), "utf-8"),
);

const defuddleOutput = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-defuddle-output.json"), "utf-8"),
);

// Mock formatDate from utils for deterministic dates.
vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    formatDate: vi.fn(() => "2025-06-15"),
  };
});

const { generateNote } = await import("../src/note.js");

// --- Helpers -----------------------------------------------------------------

/** Build the extractedData shape that generateNote expects. */
function buildExtractedData(overrides = {}) {
  return {
    content: defuddleOutput.content,
    title: defuddleOutput.title,
    description: defuddleOutput.description || "",
    domain: defuddleOutput.domain || "",
    author: defuddleOutput.author || "",
    site: defuddleOutput.site || "",
    published: defuddleOutput.published || "",
    wordCount: defuddleOutput.wordCount || 0,
    language: defuddleOutput.language || "en",
    favicon: defuddleOutput.favicon || "",
    image: defuddleOutput.image || "",
    url: "https://martinfowler.com/articles/platform-prerequisites.html",
    ...overrides,
  };
}

/** Parse YAML frontmatter from a note string. */
function parseFrontmatter(noteContent) {
  const match = noteContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("No frontmatter found");
  return yaml.parse(match[1]);
}

// --- Tests -------------------------------------------------------------------

describe("generateNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates valid YAML frontmatter", () => {
    const { content } = generateNote(claudeResponse, buildExtractedData());

    const fm = parseFrontmatter(content);

    expect(fm.title).toBe(claudeResponse.title);
    expect(fm.author).toBe(claudeResponse.author);
    expect(fm.source).toBe(claudeResponse.source);
    expect(fm.url).toBe("https://martinfowler.com/articles/platform-prerequisites.html");
    expect(fm.published).toBe(claudeResponse.published);
    expect(fm.category).toBe(claudeResponse.category);
    expect(fm.sentiment).toBe(claudeResponse.sentiment);
    expect(fm.reading_time).toBe(claudeResponse.readingTimeMinutes);
    expect(fm.word_count).toBe(defuddleOutput.wordCount);
    expect(fm.language).toBe("en");
    expect(fm.topics).toEqual(claudeResponse.topics);
    expect(fm.tags).toEqual(expect.arrayContaining(["glean"]));
    expect(fm.key_takeaways).toEqual(claudeResponse.keyTakeaways);
    expect(fm.gleaned).toBeDefined();
    expect(fm.updated).toBeDefined();
  });

  it("renders Markdown body correctly", () => {
    const { content } = generateNote(claudeResponse, buildExtractedData());

    expect(content).toContain("## Summary");
    expect(content).toContain("## Key Takeaways");
    expect(content).toContain("## Source");
    expect(content).toContain(claudeResponse.summary);
    // Key takeaways rendered as bullet points.
    for (const takeaway of claudeResponse.keyTakeaways) {
      expect(content).toContain(`- ${takeaway}`);
    }
  });

  it("combines frontmatter and body with --- delimiters", () => {
    const { content } = generateNote(claudeResponse, buildExtractedData());

    expect(content.startsWith("---\n")).toBe(true);
    // There should be a closing --- followed by the body.
    const parts = content.split("---");
    // parts[0] is empty (before first ---), parts[1] is YAML, parts[2] is the body.
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it("handles special characters in title", () => {
    const specialSummary = {
      ...claudeResponse,
      title: 'The "Art" of Code: A Developer\'s Guide',
    };

    const { content } = generateNote(specialSummary, buildExtractedData());

    // Should still parse as valid YAML despite colons and quotes.
    const fm = parseFrontmatter(content);
    expect(fm.title).toBe('The "Art" of Code: A Developer\'s Guide');
  });

  it("handles empty optional fields", () => {
    const minimalSummary = {
      ...claudeResponse,
      author: "",
      published: "",
    };
    const minimalExtracted = buildExtractedData({
      author: "",
      published: "",
    });

    const { content, filename, frontmatter } = generateNote(
      minimalSummary,
      minimalExtracted,
    );

    expect(content).toBeDefined();
    expect(filename).toBeDefined();
    expect(frontmatter.author).toBe("");
    expect(frontmatter.published).toBe("");
  });

  it("sets gleaned and updated dates for new notes", () => {
    const { frontmatter } = generateNote(claudeResponse, buildExtractedData());

    expect(frontmatter.gleaned).toBe("2025-06-15");
    expect(frontmatter.updated).toBe("2025-06-15");
  });

  it("preserves gleaned date on update", () => {
    const { frontmatter } = generateNote(claudeResponse, buildExtractedData(), {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean"],
      },
    });

    expect(frontmatter.gleaned).toBe("2025-01-01");
    expect(frontmatter.updated).toBe("2025-06-15");
  });

  it("merges tags on update", () => {
    const { frontmatter } = generateNote(claudeResponse, buildExtractedData(), {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean", "custom-tag"],
      },
      additionalTags: ["new-tag"],
    });

    expect(frontmatter.tags).toContain("glean");
    expect(frontmatter.tags).toContain("custom-tag");
    expect(frontmatter.tags).toContain("new-tag");
  });

  it("uses existing filename on update", () => {
    const { filename } = generateNote(claudeResponse, buildExtractedData(), {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean"],
        filename: "my-existing-note",
      },
    });

    expect(filename).toBe("my-existing-note");
  });

  it("applies category override", () => {
    const { frontmatter } = generateNote(claudeResponse, buildExtractedData(), {
      category: "ai",
    });

    expect(frontmatter.category).toBe("ai");
    // Original category from summaryData would be "engineering-management" but
    // the override should take precedence.
    expect(frontmatter.category).not.toBe(claudeResponse.category);
  });
});
