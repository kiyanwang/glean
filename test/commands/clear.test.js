import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "../../src/db.js";
import { enqueueJob, claimNextJob, completeJob, failJob, getAllJobs } from "../../src/queue.js";
import { clearHistory } from "../../src/commands/clear.js";

const TEST_URL = "https://example.com/article";

function buildExtractedData() {
  return {
    content: "Article body",
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

beforeEach(() => {
  vi.clearAllMocks();
  closeDb();
  getDb(":memory:");
});

afterEach(() => {
  closeDb();
});

describe("clearHistory", () => {
  it("clears completed and failed by default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const j1 = enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(j1.id, "/vault/note.md", "note");

    // Add a pending job that should NOT be cleared.
    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});

    await clearHistory({});

    const remaining = getAllJobs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("pending");
    expect(logSpy.mock.calls[0][0]).toContain("completed/failed");

    logSpy.mockRestore();
  });

  it("clears only failed when --failed is set", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create a completed job.
    const j1 = enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(j1.id, "/vault/note.md", "note");

    // Create a failed job.
    const j2 = enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    failJob(j2.id, "err");
    claimNextJob();
    failJob(j2.id, "err");
    claimNextJob();
    failJob(j2.id, "err");

    await clearHistory({ failed: true });

    const remaining = getAllJobs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("completed");

    logSpy.mockRestore();
  });

  it("clears everything when --all is set (non-TTY)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // In non-TTY mode, no confirmation prompt.
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;

    enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});

    await clearHistory({ all: true });

    expect(getAllJobs()).toHaveLength(0);
    expect(logSpy.mock.calls[0][0]).toContain("Cleared 2 job(s).");

    process.stdin.isTTY = origIsTTY;
    logSpy.mockRestore();
  });
});
