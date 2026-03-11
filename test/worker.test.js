import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "../src/db.js";
import { enqueueJob, claimNextJob } from "../src/queue.js";

// --- Mock external modules ---------------------------------------------------

vi.mock("../src/summarise.js", () => ({
  summariseContent: vi.fn(),
}));

vi.mock("../src/note.js", () => ({
  generateNote: vi.fn(),
}));

vi.mock("../src/store.js", () => ({
  writeNote: vi.fn(),
  updateIndex: vi.fn(),
  deployBase: vi.fn(),
  ensureFolder: vi.fn(),
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveUniqueFilename: vi.fn(),
  };
});

vi.mock("../src/tweet.js", () => ({
  composeTweet: vi.fn(),
  openTweetIntent: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

const { summariseContent } = await import("../src/summarise.js");
const { generateNote } = await import("../src/note.js");
const { writeNote, updateIndex, deployBase, ensureFolder } = await import("../src/store.js");
const { resolveUniqueFilename } = await import("../src/utils.js");
const { existsSync } = await import("fs");
const { composeTweet, openTweetIntent } = await import("../src/tweet.js");

// Import processJob for direct testing.
const { processJob } = await import("../src/worker.js");

// --- Test fixtures -----------------------------------------------------------

const TEST_URL = "https://example.com/article";

function buildExtractedData() {
  return {
    content: "Article body text...",
    title: "Test Article",
    url: TEST_URL,
    wordCount: 500,
    language: "en",
  };
}

function buildConfig() {
  return {
    vault: "Knowledge Base",
    vaultPath: "/vault",
    folder: "Glean",
    defaultTags: ["glean"],
    model: "haiku",
  };
}

function buildNoteResult() {
  return {
    content: "---\ntitle: Test\n---\n\n## Summary\n\nTest body.",
    filename: "test-article",
    frontmatter: {
      title: "Test Article",
      gleaned: "2026-03-11",
      updated: "2026-03-11",
    },
  };
}

function setupJobMocks() {
  summariseContent.mockReturnValue({
    title: "Test Article",
    summary: "Test summary",
    keyTakeaways: ["takeaway"],
    topics: ["testing"],
    category: "software-engineering",
    readingTimeMinutes: 5,
    sentiment: "informative",
  });
  generateNote.mockReturnValue(buildNoteResult());
  resolveUniqueFilename.mockResolvedValue("test-article");
  writeNote.mockResolvedValue("/vault/Glean/test-article.md");
  updateIndex.mockResolvedValue(undefined);
  deployBase.mockResolvedValue(undefined);
  ensureFolder.mockResolvedValue(undefined);
  existsSync.mockReturnValue(true);
}

// --- Setup / teardown --------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  closeDb();
  getDb(":memory:");
  setupJobMocks();
});

afterEach(() => {
  closeDb();
});

// --- Tests -------------------------------------------------------------------

describe("processJob", () => {
  it("processes a single job successfully", async () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    const claimed = claimNextJob();

    const result = await processJob(claimed);

    expect(result.path).toBe("/vault/Glean/test-article.md");
    expect(result.filename).toBe("test-article");

    expect(summariseContent).toHaveBeenCalledWith(buildExtractedData(), "haiku");
    expect(generateNote).toHaveBeenCalled();
    expect(writeNote).toHaveBeenCalledWith(
      buildNoteResult().content,
      "test-article",
      "/vault",
      "Glean",
    );
    expect(updateIndex).toHaveBeenCalled();
    expect(deployBase).toHaveBeenCalled();
  });

  it("handles update flow with existing filename", async () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {}, {
      isUpdate: true,
      existingMeta: { title: "Old Title", gleaned: "2025-01-01" },
      existingFilename: "existing-article",
    });
    const claimed = claimNextJob();

    await processJob(claimed);

    // Should use the existing filename, not resolveUniqueFilename.
    expect(resolveUniqueFilename).not.toHaveBeenCalled();
    expect(writeNote).toHaveBeenCalledWith(
      expect.any(String),
      "existing-article",
      "/vault",
      "Glean",
    );
  });

  it("throws when vault path does not exist", async () => {
    existsSync.mockReturnValue(false);

    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    const claimed = claimNextJob();

    await expect(processJob(claimed)).rejects.toThrow("Vault path does not exist");
  });

  it("handles summarisation failure", async () => {
    summariseContent.mockImplementation(() => {
      throw new Error("Claude CLI failed");
    });

    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    const claimed = claimNextJob();

    await expect(processJob(claimed)).rejects.toThrow("Claude CLI failed");
  });

  it("parses tags from CLI options string", async () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {
      tags: "ai,testing",
      category: "software-engineering",
    });
    const claimed = claimNextJob();

    await processJob(claimed);

    expect(generateNote).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        additionalTags: ["ai", "testing"],
        category: "software-engineering",
      }),
    );
  });

  it("opens tweet intent when --tweet option is set", async () => {
    composeTweet.mockReturnValue("Great article https://example.com/article");

    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), { tweet: true });
    const claimed = claimNextJob();

    await processJob(claimed);

    expect(composeTweet).toHaveBeenCalledWith(
      undefined, // tweetSummary not in mock summaryData
      TEST_URL,
      "Test Article",
    );
    expect(openTweetIntent).toHaveBeenCalledWith("Great article https://example.com/article");
  });

  it("does not open tweet intent when --tweet not set", async () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    const claimed = claimNextJob();

    await processJob(claimed);

    expect(composeTweet).not.toHaveBeenCalled();
    expect(openTweetIntent).not.toHaveBeenCalled();
  });
});
