import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "../../src/db.js";
import { enqueueJob, claimNextJob, failJob, getJobById } from "../../src/queue.js";
import { retryJobs } from "../../src/commands/retry.js";

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

function makeFailedJob(url) {
  const job = enqueueJob(url, buildExtractedData(), buildConfig(), {});
  claimNextJob();
  failJob(job.id, "err");
  claimNextJob();
  failJob(job.id, "err");
  claimNextJob();
  failJob(job.id, "err");
  return job;
}

beforeEach(() => {
  vi.clearAllMocks();
  closeDb();
  getDb(":memory:");
});

afterEach(() => {
  closeDb();
});

describe("retryJobs", () => {
  it("retries specific failed job and spawns worker", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const spawnWorkerFn = vi.fn();

    const job = makeFailedJob(TEST_URL);

    retryJobs(job.id, spawnWorkerFn);

    const after = getJobById(job.id);
    expect(after.status).toBe("pending");
    expect(spawnWorkerFn).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0][0]).toContain("reset to pending");

    logSpy.mockRestore();
  });

  it("retries all failed jobs and spawns worker", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const spawnWorkerFn = vi.fn();

    makeFailedJob(TEST_URL + "/1");
    makeFailedJob(TEST_URL + "/2");

    retryJobs(undefined, spawnWorkerFn);

    expect(spawnWorkerFn).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0][0]).toContain("Reset 2 failed job(s)");

    logSpy.mockRestore();
  });

  it("reports when no failed jobs exist", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const spawnWorkerFn = vi.fn();

    retryJobs(undefined, spawnWorkerFn);

    expect(spawnWorkerFn).not.toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0]).toContain("No failed jobs to retry");

    logSpy.mockRestore();
  });

  it("reports when job ID not found", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const spawnWorkerFn = vi.fn();

    expect(() => retryJobs("nonexistent", spawnWorkerFn)).toThrow("exit");
    expect(errorSpy).toHaveBeenCalledWith("No failed job found with ID: nonexistent");
    expect(spawnWorkerFn).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
