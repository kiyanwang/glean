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
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn((...args) => actual.existsSync(...args)),
    readFileSync: vi.fn((...args) => actual.readFileSync(...args)),
  };
});

vi.mock("../src/tweet.js", () => ({
  composeTweet: vi.fn(),
  openTweetIntent: vi.fn(),
}));

vi.mock("../src/queue.js", () => ({
  findPendingJobByUrl: vi.fn(),
  enqueueJob: vi.fn(),
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

const { spawn } = await import("child_process");
const { existsSync, readFileSync: mockedReadFileSync } = await import("fs");
const { composeTweet, openTweetIntent } = await import("../src/tweet.js");
const { findPendingJobByUrl, enqueueJob } = await import("../src/queue.js");

// Import the functions under test.
const { glean, gleanAsync, spawnWorker } = await import("../src/index.js");

// --- Helpers -----------------------------------------------------------------

/** Configure all mocks for a successful create flow. */
function setupHappyPath() {
  loadConfig.mockResolvedValue({
    vault: "Knowledge Base",
    vaultPath: "/vault",
    folder: "Glean",
    defaultTags: ["glean"],
    model: "haiku",
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
    expect(summariseContent).toHaveBeenCalledWith(buildExtractedData(), "haiku");
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

  it("--tweet opens intent URL after note creation", async () => {
    setupHappyPath();
    composeTweet.mockReturnValue("Great article https://martinfowler.com/articles/platform-prerequisites.html");

    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await glean(TEST_URL, { vaultPath: "/vault", folder: "Glean", tweet: true });

    expect(composeTweet).toHaveBeenCalledWith(
      claudeResponse.tweetSummary,
      TEST_URL,
      claudeResponse.title,
    );
    expect(openTweetIntent).toHaveBeenCalledWith(
      "Great article https://martinfowler.com/articles/platform-prerequisites.html",
    );

    stderrSpy.mockRestore();
  });

  it("--tweet --dry-run prints tweet text without opening browser", async () => {
    setupHappyPath();
    composeTweet.mockReturnValue("Great article https://martinfowler.com/articles/platform-prerequisites.html");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await glean(TEST_URL, {
      vaultPath: "/vault",
      folder: "Glean",
      dryRun: true,
      tweet: true,
    });

    // Should print tweet text to stderr.
    expect(stderrSpy.mock.calls.some((c) => c[0].includes("Tweet:"))).toBe(true);

    // Should NOT open the browser.
    expect(openTweetIntent).not.toHaveBeenCalled();

    // Result should include tweet field.
    expect(result.tweet).toBe("Great article https://martinfowler.com/articles/platform-prerequisites.html");

    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("--tweet --json includes tweet field in output", async () => {
    setupHappyPath();
    composeTweet.mockReturnValue("Great article https://martinfowler.com/articles/platform-prerequisites.html");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await glean(TEST_URL, {
      vaultPath: "/vault",
      folder: "Glean",
      json: true,
      tweet: true,
    });

    const outputArg = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(outputArg);
    expect(parsed.tweet).toBe("Great article https://martinfowler.com/articles/platform-prerequisites.html");

    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

// --- Async path tests --------------------------------------------------------

describe("gleanAsync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setupHappyPath();

    // Default queue mocks.
    findPendingJobByUrl.mockReturnValue(null);
    enqueueJob.mockReturnValue({
      id: "test-job-id-1234",
      url: TEST_URL,
      status: "pending",
      created_at: "2026-03-11 14:00:00",
    });

    // spawnWorker needs existsSync to return false (no PID file).
    existsSync.mockReturnValue(false);
  });

  it("extracts content and enqueues a job", async () => {
    await gleanAsync(TEST_URL, { vaultPath: "/vault", folder: "Glean" });

    expect(extractContent).toHaveBeenCalledWith(TEST_URL);
    expect(enqueueJob).toHaveBeenCalledWith(
      TEST_URL,
      buildExtractedData(),
      expect.objectContaining({ vaultPath: "/vault", folder: "Glean" }),
      expect.any(Object),
      expect.objectContaining({ isUpdate: false }),
    );
  });

  it("detects duplicate pending job", async () => {
    findPendingJobByUrl.mockReturnValue({
      id: "existing-job-id",
      url: TEST_URL,
      status: "pending",
    });

    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await gleanAsync(TEST_URL, { vaultPath: "/vault", folder: "Glean" });

    // Should NOT enqueue a new job.
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.some((c) => c[0].includes("already queued"))).toBe(true);

    stderrSpy.mockRestore();
  });

  it("rejects without vault path", async () => {
    loadConfig.mockResolvedValue({
      vault: "Knowledge Base",
      vaultPath: null,
      folder: "Glean",
      defaultTags: ["glean"],
      model: "haiku",
    });

    await expect(
      gleanAsync(TEST_URL, {}),
    ).rejects.toThrow("No vault path configured");
  });

  it("rejects invalid URL", async () => {
    validateUrl.mockReturnValue(false);

    await expect(
      gleanAsync("not-a-url", { vaultPath: "/vault" }),
    ).rejects.toThrow("Invalid URL");
  });
});

describe("spawnWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    existsSync.mockReturnValue(false);
  });

  it("spawns when no worker running (no PID file)", () => {
    existsSync.mockReturnValue(false);

    spawnWorker();

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringContaining("worker.js")]),
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
  });

  it("skips spawn when worker already running", () => {
    existsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(String(process.pid)); // Current process is alive.
    // process.kill(pid, 0) will succeed for our own PID.

    spawnWorker();

    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns when PID file is stale (process not running)", () => {
    existsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("999999999"); // Non-existent PID.

    spawnWorker();

    expect(spawn).toHaveBeenCalled();
  });
});
