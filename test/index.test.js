import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const claudeResponse = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-claude-response.json"), "utf-8"),
);

const defuddleOutput = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-defuddle-output.json"), "utf-8"),
);

// --- Build fixture data matching module return shapes ------------------------

const TEST_URL = "https://martinfowler.com/articles/platform-prerequisites.html";

function buildExtractedData() {
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
    url: TEST_URL,
  };
}

function buildNoteResult() {
  return {
    content: "---\ntitle: Test\n---\n\n## Summary\n\nTest body.",
    filename: "platform-prerequisites-for-self-service",
    frontmatter: {
      title: claudeResponse.title,
      author: claudeResponse.author,
      source: claudeResponse.source,
      url: TEST_URL,
      published: claudeResponse.published,
      gleaned: "2025-06-15",
      updated: "2025-06-15",
      category: claudeResponse.category,
      sentiment: claudeResponse.sentiment,
      reading_time: claudeResponse.readingTimeMinutes,
      word_count: defuddleOutput.wordCount,
      language: "en",
      topics: claudeResponse.topics,
      tags: ["glean", claudeResponse.category],
      key_takeaways: claudeResponse.keyTakeaways,
    },
  };
}

// --- Mock all external modules -----------------------------------------------

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../src/utils.js", () => ({
  validateUrl: vi.fn(),
  resolveUniqueFilename: vi.fn(),
}));

vi.mock("../src/store.js", () => ({
  ensureFolder: vi.fn(),
  findExistingNote: vi.fn(),
  readExistingMeta: vi.fn(),
  writeNote: vi.fn(),
  updateIndex: vi.fn(),
  deployBase: vi.fn(),
}));

vi.mock("../src/extract.js", () => ({
  extractContent: vi.fn(),
}));

vi.mock("../src/summarise.js", () => ({
  summariseContent: vi.fn(),
}));

vi.mock("../src/note.js", () => ({
  generateNote: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Import mocked modules.
const { loadConfig } = await import("../src/config.js");
const { validateUrl, resolveUniqueFilename } = await import("../src/utils.js");
const {
  ensureFolder,
  findExistingNote,
  readExistingMeta,
  writeNote,
  updateIndex,
  deployBase,
} = await import("../src/store.js");
const { extractContent } = await import("../src/extract.js");
const { summariseContent } = await import("../src/summarise.js");
const { generateNote } = await import("../src/note.js");

// Import the function under test.
const { glean } = await import("../src/index.js");

// --- Helpers -----------------------------------------------------------------

/** Configure all mocks for a successful create flow. */
function setupHappyPath() {
  loadConfig.mockResolvedValue({
    vault: "Knowledge Base",
    vaultPath: "/vault",
    folder: "Glean",
    defaultTags: ["glean"],
    model: "sonnet",
  });

  validateUrl.mockReturnValue(true);
  ensureFolder.mockResolvedValue(undefined);
  findExistingNote.mockResolvedValue(null);

  extractContent.mockResolvedValue(buildExtractedData());
  summariseContent.mockReturnValue(claudeResponse);
  generateNote.mockReturnValue(buildNoteResult());

  resolveUniqueFilename.mockResolvedValue("platform-prerequisites-for-self-service");
  writeNote.mockResolvedValue("/vault/Glean/platform-prerequisites-for-self-service.md");
  updateIndex.mockResolvedValue(undefined);
  deployBase.mockResolvedValue(undefined);
}

// --- Tests -------------------------------------------------------------------

describe("glean orchestration (index.js)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("full create flow (happy path)", async () => {
    setupHappyPath();

    const result = await glean(TEST_URL, { vaultPath: "/vault", folder: "Glean" });

    // Verify each step was called in order.
    expect(extractContent).toHaveBeenCalledWith(TEST_URL);
    expect(summariseContent).toHaveBeenCalledWith(buildExtractedData());
    expect(generateNote).toHaveBeenCalledWith(
      claudeResponse,
      buildExtractedData(),
      expect.objectContaining({ isUpdate: false, existingMeta: null }),
    );
    expect(writeNote).toHaveBeenCalledWith(
      buildNoteResult().content,
      "platform-prerequisites-for-self-service",
      "/vault",
      "Glean",
    );
    expect(updateIndex).toHaveBeenCalledWith(
      "/vault",
      "Glean",
      TEST_URL,
      "platform-prerequisites-for-self-service",
      "2025-06-15",
      "2025-06-15",
    );

    // Verify result shape.
    expect(result.path).toBe("/vault/Glean/platform-prerequisites-for-self-service.md");
    expect(result.isUpdate).toBe(false);
  });

  it("full update flow (happy path)", async () => {
    setupHappyPath();

    // Override: findExistingNote returns an existing entry.
    const existingEntry = {
      filename: "platform-prerequisites-for-self-service",
      gleaned: "2025-01-01",
      updated: "2025-01-01",
    };
    findExistingNote.mockResolvedValue(existingEntry);

    const existingMeta = {
      title: "Platform Prerequisites for Self-Service",
      url: TEST_URL,
      gleaned: "2025-01-01",
      updated: "2025-01-01",
      tags: ["glean", "engineering-management"],
    };
    readExistingMeta.mockResolvedValue(existingMeta);

    // generateNote for update returns the note with isUpdate semantics.
    const updateNote = buildNoteResult();
    updateNote.frontmatter.gleaned = "2025-01-01";
    generateNote.mockReturnValue(updateNote);

    const result = await glean(TEST_URL, {
      vaultPath: "/vault",
      folder: "Glean",
      update: true,
    });

    // Verify readExistingMeta was called for the existing file.
    expect(readExistingMeta).toHaveBeenCalled();

    // Verify generateNote received isUpdate=true and existingMeta.
    expect(generateNote).toHaveBeenCalledWith(
      claudeResponse,
      buildExtractedData(),
      expect.objectContaining({
        isUpdate: true,
        existingMeta,
      }),
    );

    // Verify result reflects an update.
    expect(result.isUpdate).toBe(true);
  });

  it("dry run outputs to stdout and doesn't write", async () => {
    setupHappyPath();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await glean(TEST_URL, {
      vaultPath: "/vault",
      folder: "Glean",
      dryRun: true,
    });

    // writeNote should NOT be called in dry-run mode.
    expect(writeNote).not.toHaveBeenCalled();
    expect(updateIndex).not.toHaveBeenCalled();

    // console.log should have been called with the note content.
    expect(consoleSpy).toHaveBeenCalledWith(buildNoteResult().content);

    // Result should indicate dry run.
    expect(result.dryRun).toBe(true);
    expect(result.content).toBe(buildNoteResult().content);

    consoleSpy.mockRestore();
  });

  it("JSON flag outputs structured data", async () => {
    setupHappyPath();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await glean(TEST_URL, {
      vaultPath: "/vault",
      folder: "Glean",
      json: true,
    });

    // writeNote should NOT be called in JSON output mode.
    expect(writeNote).not.toHaveBeenCalled();
    expect(updateIndex).not.toHaveBeenCalled();

    // console.log should have been called with parseable JSON.
    expect(consoleSpy).toHaveBeenCalled();
    const outputArg = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(outputArg);

    expect(parsed).toHaveProperty("frontmatter");
    expect(parsed).toHaveProperty("filename");
    expect(parsed.frontmatter.title).toBe(claudeResponse.title);
    expect(parsed.filename).toBe("platform-prerequisites-for-self-service");

    consoleSpy.mockRestore();
  });

  it("extraction failure halts pipeline", async () => {
    setupHappyPath();

    // Override: extraction throws.
    extractContent.mockRejectedValue(new Error("Failed to fetch URL"));

    await expect(
      glean(TEST_URL, { vaultPath: "/vault", folder: "Glean" }),
    ).rejects.toThrow("Failed to fetch URL");

    // summariseContent should NOT have been called since extraction failed.
    expect(summariseContent).not.toHaveBeenCalled();
    expect(generateNote).not.toHaveBeenCalled();
    expect(writeNote).not.toHaveBeenCalled();
  });

  it("summarisation failure halts pipeline", async () => {
    setupHappyPath();

    // Override: summarisation throws.
    summariseContent.mockImplementation(() => {
      throw new Error("Claude CLI failed");
    });

    await expect(
      glean(TEST_URL, { vaultPath: "/vault", folder: "Glean" }),
    ).rejects.toThrow("Claude CLI failed");

    // writeNote should NOT have been called since summarisation failed.
    expect(writeNote).not.toHaveBeenCalled();
    expect(updateIndex).not.toHaveBeenCalled();
  });
});
