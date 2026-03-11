import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import path from "path";
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

// Mock fs/promises for store tests.
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  copyFile: vi.fn(),
}));

const { readFile, writeFile, mkdir, readdir } = await import("fs/promises");
const { generateNote } = await import("../src/note.js");
const { findExistingNote } = await import("../src/store.js");

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

function enoentError() {
  const err = new Error("ENOENT: no such file or directory");
  err.code = "ENOENT";
  return err;
}

// --- Tests -------------------------------------------------------------------

describe("update / re-glean flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue(undefined);
    mkdir.mockResolvedValue(undefined);
  });

  it("detects existing note by URL in index", async () => {
    const indexData = {
      "https://martinfowler.com/articles/platform-prerequisites.html": {
        filename: "platform-prerequisites-for-self-service",
        gleaned: "2025-01-01",
        updated: "2025-01-01",
      },
    };
    readFile.mockResolvedValueOnce(JSON.stringify(indexData));

    const result = await findExistingNote(
      "https://martinfowler.com/articles/platform-prerequisites.html",
      "/vault",
      "Glean",
    );

    expect(result).not.toBeNull();
    expect(result.filename).toBe("platform-prerequisites-for-self-service");
    expect(result.gleaned).toBe("2025-01-01");
  });

  it("preserves original gleaned date on update", () => {
    const { frontmatter } = generateNote(claudeResponse, buildExtractedData(), {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean"],
      },
    });

    expect(frontmatter.gleaned).toBe("2025-01-01");
    // Should NOT be today's mocked date.
    expect(frontmatter.gleaned).not.toBe("2025-06-15");
  });

  it("sets updated to today on re-glean", () => {
    const { frontmatter } = generateNote(claudeResponse, buildExtractedData(), {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean"],
      },
    });

    expect(frontmatter.updated).toBe("2025-06-15");
  });

  it("merges tags - user tags preserved", () => {
    const { frontmatter } = generateNote(claudeResponse, buildExtractedData(), {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean", "my-custom-tag"],
      },
    });

    // Default tag "glean" is preserved.
    expect(frontmatter.tags).toContain("glean");
    // User's custom tag from existing note is preserved.
    expect(frontmatter.tags).toContain("my-custom-tag");
    // Category from summary ("engineering-management") is included as a tag.
    expect(frontmatter.tags).toContain(claudeResponse.category);
  });

  it("overwrites note body with fresh summary", () => {
    const firstSummary = {
      ...claudeResponse,
      summary: "This is the original summary from the first glean.",
    };
    const secondSummary = {
      ...claudeResponse,
      summary: "This is a completely new summary from the re-glean.",
    };
    const extracted = buildExtractedData();

    const first = generateNote(firstSummary, extracted);
    const second = generateNote(secondSummary, extracted, {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean"],
      },
    });

    expect(first.content).toContain("This is the original summary from the first glean.");
    expect(first.content).not.toContain("This is a completely new summary from the re-glean.");

    expect(second.content).toContain("This is a completely new summary from the re-glean.");
    expect(second.content).not.toContain("This is the original summary from the first glean.");
  });

  it("reuses existing filename on update", () => {
    const { filename } = generateNote(claudeResponse, buildExtractedData(), {
      isUpdate: true,
      existingMeta: {
        gleaned: "2025-01-01",
        tags: ["glean"],
        filename: "old-filename",
      },
    });

    expect(filename).toBe("old-filename");
  });

  it("creates new note when URL not found with --update", async () => {
    // Index has no entries for the given URL.
    const indexData = {
      "https://example.com/other-article": {
        filename: "other-article",
        gleaned: "2025-01-01",
        updated: "2025-01-01",
      },
    };
    readFile.mockResolvedValueOnce(JSON.stringify(indexData));

    const result = await findExistingNote(
      "https://martinfowler.com/articles/platform-prerequisites.html",
      "/vault",
      "Glean",
    );

    // findExistingNote returns null — no match.
    expect(result).toBeNull();

    // The flow should still work: generate a new note without error.
    const { content, filename, frontmatter } = generateNote(
      claudeResponse,
      buildExtractedData(),
      {
        isUpdate: false,
        existingMeta: null,
      },
    );

    expect(content).toBeDefined();
    expect(filename).toBeDefined();
    expect(frontmatter.title).toBe(claudeResponse.title);
    // New note gets today's date for both gleaned and updated.
    expect(frontmatter.gleaned).toBe("2025-06-15");
    expect(frontmatter.updated).toBe("2025-06-15");
  });
});
