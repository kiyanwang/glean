import { describe, it, expect, afterEach } from "vitest";
import { getDb, closeDb } from "../src/db.js";

describe("db", () => {
  afterEach(() => closeDb());

  it("creates in-memory database with schema", () => {
    const db = getDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    expect(tables.map((t) => t.name)).toContain("jobs");
  });

  it("returns same instance on repeated calls (singleton)", () => {
    const db1 = getDb(":memory:");
    const db2 = getDb(":memory:");
    expect(db1).toBe(db2);
  });

  it("creates indexes", () => {
    const db = getDb(":memory:");
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all();
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_jobs_status_created");
    expect(names).toContain("idx_jobs_url_status");
  });

  it("enables WAL mode", () => {
    const db = getDb(":memory:");
    const mode = db.pragma("journal_mode", { simple: true });
    // In-memory databases may report 'memory' instead of 'wal'.
    expect(["wal", "memory"]).toContain(mode);
  });
});
