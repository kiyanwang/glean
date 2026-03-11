import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDb, closeDb } from "../src/db.js";
import {
  enqueueJob,
  claimNextJob,
  completeJob,
  failJob,
  getJobById,
  getJobSummary,
  getAllJobs,
  findPendingJobByUrl,
  retryJob,
  retryAllFailed,
  clearJobs,
  recoverStaleJobs,
} from "../src/queue.js";

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

function buildOptions() {
  return { tags: "ai,testing", category: "software-engineering" };
}

// --- Setup / teardown --------------------------------------------------------

beforeEach(() => {
  // Close any previous instance so each test gets a fresh database.
  closeDb();
  getDb(":memory:");
});

afterEach(() => {
  closeDb();
});

// --- Tests -------------------------------------------------------------------

describe("enqueueJob", () => {
  it("creates a job with status pending", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), buildOptions());

    expect(job.id).toBeTruthy();
    expect(job.url).toBe(TEST_URL);
    expect(job.status).toBe("pending");
    expect(job.created_at).toBeTruthy();
  });

  it("stores all fields correctly including JSON serialisation", () => {
    const extracted = buildExtractedData();
    const config = buildConfig();
    const options = buildOptions();

    const job = enqueueJob(TEST_URL, extracted, config, options, {
      isUpdate: true,
      existingMeta: { title: "Old Title", gleaned: "2025-01-01" },
      existingFilename: "old-article",
    });

    const full = getJobById(job.id);
    expect(full.url).toBe(TEST_URL);
    expect(JSON.parse(full.extracted_data)).toEqual(extracted);
    expect(JSON.parse(full.cli_options)).toEqual(options);
    expect(JSON.parse(full.config_snapshot)).toEqual(config);
    expect(full.vault_path).toBe("/vault");
    expect(full.folder).toBe("Glean");
    expect(full.is_update).toBe(1);
    expect(JSON.parse(full.existing_meta)).toEqual({ title: "Old Title", gleaned: "2025-01-01" });
    expect(full.existing_filename).toBe("old-article");
    expect(full.attempts).toBe(0);
    expect(full.max_attempts).toBe(3);
  });
});

describe("claimNextJob", () => {
  it("returns oldest pending job", () => {
    enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/3", buildExtractedData(), buildConfig(), {});

    const claimed = claimNextJob();
    expect(claimed.url).toBe(TEST_URL + "/1");
    expect(claimed.status).toBe("processing");
  });

  it("returns null when queue is empty", () => {
    expect(claimNextJob()).toBeNull();
  });

  it("sets status to processing and populates started_at", () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    const claimed = claimNextJob();

    expect(claimed.status).toBe("processing");
    expect(claimed.started_at).toBeTruthy();
  });

  it("increments attempts", () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    const claimed = claimNextJob();

    expect(claimed.attempts).toBe(1);
  });

  it("does not return already-processing jobs", () => {
    enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});

    const first = claimNextJob();
    const second = claimNextJob();

    expect(first.url).toBe(TEST_URL + "/1");
    expect(second.url).toBe(TEST_URL + "/2");
  });
});

describe("completeJob", () => {
  it("sets status and result fields", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    claimNextJob();

    completeJob(job.id, "/vault/Glean/test-article.md", "test-article");

    const completed = getJobById(job.id);
    expect(completed.status).toBe("completed");
    expect(completed.result_path).toBe("/vault/Glean/test-article.md");
    expect(completed.result_filename).toBe("test-article");
    expect(completed.completed_at).toBeTruthy();
  });
});

describe("failJob", () => {
  it("resets to pending when retries remain", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    claimNextJob(); // attempts = 1, max_attempts = 3

    failJob(job.id, "Claude CLI failed");

    const failed = getJobById(job.id);
    expect(failed.status).toBe("pending");
    expect(failed.error_message).toBe("Claude CLI failed");
    expect(failed.started_at).toBeNull();
  });

  it("marks as failed when retries exhausted", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});

    // Exhaust all 3 attempts.
    claimNextJob();
    failJob(job.id, "Attempt 1");
    claimNextJob();
    failJob(job.id, "Attempt 2");
    claimNextJob();
    failJob(job.id, "Attempt 3");

    const failed = getJobById(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error_message).toBe("Attempt 3");
    expect(failed.completed_at).toBeTruthy();
  });

  it("does nothing for non-existent job", () => {
    failJob("nonexistent-id", "error");
    // Should not throw.
  });
});

describe("findPendingJobByUrl", () => {
  it("detects duplicate pending job", () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});

    const found = findPendingJobByUrl(TEST_URL);
    expect(found).toBeTruthy();
    expect(found.url).toBe(TEST_URL);
  });

  it("normalises URLs for comparison", () => {
    enqueueJob("https://Example.com/article/", buildExtractedData(), buildConfig(), {});

    const found = findPendingJobByUrl("https://example.com/article");
    expect(found).toBeTruthy();
  });

  it("ignores completed and failed jobs", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(job.id, "/vault/note.md", "note");

    const found = findPendingJobByUrl(TEST_URL);
    expect(found).toBeNull();
  });

  it("returns null when no match", () => {
    const found = findPendingJobByUrl("https://other.com/article");
    expect(found).toBeNull();
  });
});

describe("retryJob", () => {
  it("resets failed job to pending", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    // Exhaust retries to get to failed state.
    claimNextJob();
    failJob(job.id, "err");
    claimNextJob();
    failJob(job.id, "err");
    claimNextJob();
    failJob(job.id, "err");

    const before = getJobById(job.id);
    expect(before.status).toBe("failed");

    const success = retryJob(job.id);
    expect(success).toBe(true);

    const after = getJobById(job.id);
    expect(after.status).toBe("pending");
    expect(after.attempts).toBe(0);
    expect(after.error_message).toBeNull();
    expect(after.started_at).toBeNull();
    expect(after.completed_at).toBeNull();
  });

  it("returns false for non-failed job", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    const success = retryJob(job.id);
    expect(success).toBe(false);
  });

  it("returns false for non-existent job", () => {
    expect(retryJob("nonexistent")).toBe(false);
  });
});

describe("retryAllFailed", () => {
  it("resets all failed jobs", () => {
    // Create two failed jobs.
    for (const suffix of ["/1", "/2"]) {
      const job = enqueueJob(TEST_URL + suffix, buildExtractedData(), buildConfig(), {});
      claimNextJob();
      failJob(job.id, "err");
      claimNextJob();
      failJob(job.id, "err");
      claimNextJob();
      failJob(job.id, "err");
    }

    const count = retryAllFailed();
    expect(count).toBe(2);

    const pending = getAllJobs("pending");
    expect(pending).toHaveLength(2);
  });

  it("returns 0 when no failed jobs", () => {
    expect(retryAllFailed()).toBe(0);
  });
});

describe("clearJobs", () => {
  it("clears completed and failed by default", () => {
    const j1 = enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(j1.id, "/vault/note.md", "note");

    const j2 = enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    failJob(j2.id, "err");
    claimNextJob();
    failJob(j2.id, "err");
    claimNextJob();
    failJob(j2.id, "err");

    // Also add a pending job that should NOT be cleared.
    enqueueJob(TEST_URL + "/3", buildExtractedData(), buildConfig(), {});

    const cleared = clearJobs("completed");
    expect(cleared).toBe(2);

    const remaining = getAllJobs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("pending");
  });

  it("clears only failed when filter is 'failed'", () => {
    const j1 = enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(j1.id, "/vault/note.md", "note");

    const j2 = enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    failJob(j2.id, "err");
    claimNextJob();
    failJob(j2.id, "err");
    claimNextJob();
    failJob(j2.id, "err");

    const cleared = clearJobs("failed");
    expect(cleared).toBe(1);

    const remaining = getAllJobs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("completed");
  });

  it("clears everything when filter is 'all'", () => {
    enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/3", buildExtractedData(), buildConfig(), {});

    const cleared = clearJobs("all");
    expect(cleared).toBe(3);
    expect(getAllJobs()).toHaveLength(0);
  });
});

describe("recoverStaleJobs", () => {
  it("resets processing jobs to pending when retries remain", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    claimNextJob(); // status = processing, attempts = 1

    const recovered = recoverStaleJobs();
    expect(recovered).toBe(1);

    const after = getJobById(job.id);
    expect(after.status).toBe("pending");
    expect(after.error_message).toBe("Recovered from stale processing state");
  });

  it("marks as failed when attempts exhausted", () => {
    const job = enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});

    // Get to attempts = 3 (max_attempts = 3).
    claimNextJob();
    failJob(job.id, "err");
    claimNextJob();
    failJob(job.id, "err");
    claimNextJob(); // Now processing with attempts = 3

    const recovered = recoverStaleJobs();
    expect(recovered).toBe(1);

    const after = getJobById(job.id);
    expect(after.status).toBe("failed");
    expect(after.error_message).toContain("Exceeded max attempts");
  });

  it("returns 0 when no stale jobs", () => {
    enqueueJob(TEST_URL, buildExtractedData(), buildConfig(), {});
    expect(recoverStaleJobs()).toBe(0);
  });
});

describe("getJobSummary", () => {
  it("returns correct counts by status", () => {
    // Create one completed, one pending.
    const j1 = enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(j1.id, "/vault/note.md", "note");

    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});

    const { counts, recent } = getJobSummary();
    expect(counts.completed).toBe(1);
    expect(counts.pending).toBe(1);
    expect(recent).toHaveLength(2);
  });

  it("returns empty counts for empty queue", () => {
    const { counts, recent } = getJobSummary();
    expect(counts).toEqual({});
    expect(recent).toHaveLength(0);
  });
});

describe("getAllJobs", () => {
  it("returns all jobs when no filter", () => {
    enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});
    expect(getAllJobs()).toHaveLength(2);
  });

  it("filters by status", () => {
    const j1 = enqueueJob(TEST_URL + "/1", buildExtractedData(), buildConfig(), {});
    enqueueJob(TEST_URL + "/2", buildExtractedData(), buildConfig(), {});
    claimNextJob();
    completeJob(j1.id, "/vault/note.md", "note");

    expect(getAllJobs("completed")).toHaveLength(1);
    expect(getAllJobs("pending")).toHaveLength(1);
    expect(getAllJobs("processing")).toHaveLength(0);
  });
});
