import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "../../src/db.js";
import { enqueueJob, claimNextJob, completeJob } from "../../src/queue.js";
import { showStatus } from "../../src/commands/status.js";

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

describe("showStatus", () => {
  it("shows summary with counts", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const j1 = enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(j1.id, "/vault/note.md", "note");

    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});

    showStatus(undefined, {});

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Queue Status:");
    expect(output).toContain("Pending:");
    expect(output).toContain("Completed:");
    expect(output).toContain("Recent Jobs:");

    logSpy.mockRestore();
  });

  it("shows job detail by ID", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});

    showStatus(job.id, {});

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain(`Job:       ${job.id}`);
    expect(output).toContain(`URL:       ${TEST_URL}`);
    expect(output).toContain("Title:     Test Article");
    expect(output).toContain("Status:    pending");

    logSpy.mockRestore();
  });

  it("shows error for unknown job ID", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    expect(() => showStatus("nonexistent-id", {})).toThrow("exit");
    expect(errorSpy).toHaveBeenCalledWith("No job found with ID: nonexistent-id");

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("shows empty message when no jobs", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    showStatus(undefined, {});

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No jobs in queue.");

    logSpy.mockRestore();
  });
});
