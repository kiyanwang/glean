import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";

// Mock fs/promises before importing the module under test.
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  copyFile: vi.fn(),
}));

const { readFile, writeFile, mkdir, readdir, copyFile } = await import("fs/promises");

const {
  writeNote,
  ensureFolder,
  loadIndex,
  updateIndex,
  findExistingNote,
  readExistingMeta,
  deployBase,
} = await import("../src/store.js");

// --- Helpers -----------------------------------------------------------------

function enoentError() {
  const err = new Error("ENOENT: no such file or directory");
  err.code = "ENOENT";
  return err;
}

function mdWithFrontmatter(url, gleaned, updated) {
  return [
    "---",
    `url: ${url}`,
    `gleaned: ${gleaned}`,
    `updated: ${updated}`,
    "---",
    "",
    "Body content here.",
  ].join("\n");
}

// --- Tests -------------------------------------------------------------------

describe("store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue(undefined);
    mkdir.mockResolvedValue(undefined);
    copyFile.mockResolvedValue(undefined);
  });

  // --- writeNote -------------------------------------------------------------

  it("writes note to correct vault path", async () => {
    const result = await writeNote("content", "my-note", "/vault", "Glean");

    expect(writeFile).toHaveBeenCalledWith(
      path.join("/vault", "Glean", "my-note.md"),
      "content",
      "utf-8",
    );
    expect(result).toBe(path.join("/vault", "Glean", "my-note.md"));
  });

  // --- ensureFolder ----------------------------------------------------------

  it("creates target folder if missing", async () => {
    await ensureFolder("/vault", "Glean");

    expect(mkdir).toHaveBeenCalledWith(
      path.join("/vault", "Glean"),
      { recursive: true },
    );
  });

  // --- loadIndex -------------------------------------------------------------

  it("loads and parses .glean-index.json", async () => {
    const indexData = {
      "https://example.com/article": {
        filename: "article",
        gleaned: "2025-06-15",
        updated: "2025-06-15",
      },
    };

    readFile.mockResolvedValue(JSON.stringify(indexData));

    const result = await loadIndex("/vault", "Glean");

    expect(readFile).toHaveBeenCalledWith(
      path.join("/vault", "Glean", ".glean-index.json"),
      "utf-8",
    );
    expect(result).toEqual(indexData);
  });

  it("rebuilds index from folder contents", async () => {
    // First readFile call is for the index file — throw ENOENT.
    readFile.mockRejectedValueOnce(enoentError());

    // readdir returns two .md files.
    readdir.mockResolvedValue(["note1.md", "note2.md"]);

    // Subsequent readFile calls return frontmatter for each .md file.
    readFile.mockResolvedValueOnce(
      mdWithFrontmatter("https://example.com/one", "2025-01-01", "2025-01-02"),
    );
    readFile.mockResolvedValueOnce(
      mdWithFrontmatter("https://example.com/two", "2025-03-10", "2025-03-11"),
    );

    // The rebuilt index will be persisted — allow that write.
    writeFile.mockResolvedValue(undefined);

    const result = await loadIndex("/vault", "Glean");

    expect(result["https://example.com/one"]).toEqual({
      filename: "note1",
      gleaned: "2025-01-01",
      updated: "2025-01-02",
    });
    expect(result["https://example.com/two"]).toEqual({
      filename: "note2",
      gleaned: "2025-03-10",
      updated: "2025-03-11",
    });

    // Verify the rebuilt index is persisted to disk.
    expect(writeFile).toHaveBeenCalledWith(
      path.join("/vault", "Glean", ".glean-index.json"),
      expect.any(String),
      "utf-8",
    );
  });

  it("handles missing/corrupt index file", async () => {
    // Index file read throws.
    readFile.mockRejectedValueOnce(enoentError());

    // Folder is empty.
    readdir.mockResolvedValue([]);

    const result = await loadIndex("/vault", "Glean");

    expect(result).toEqual({});
  });

  // --- updateIndex -----------------------------------------------------------

  it("updates index after write", async () => {
    // loadIndex will be called internally — provide an existing index.
    const existingIndex = {
      "https://example.com/old": {
        filename: "old-note",
        gleaned: "2025-01-01",
        updated: "2025-01-01",
      },
    };
    readFile.mockResolvedValueOnce(JSON.stringify(existingIndex));

    await updateIndex(
      "/vault",
      "Glean",
      "https://example.com/new",
      "new-note",
      "2025-06-15",
      "2025-06-15",
    );

    // writeFile should have been called with the updated index.
    expect(writeFile).toHaveBeenCalledWith(
      path.join("/vault", "Glean", ".glean-index.json"),
      expect.any(String),
      "utf-8",
    );

    // Parse what was written and verify the new entry is present.
    const writtenJson = JSON.parse(writeFile.mock.calls[0][1]);
    expect(writtenJson["https://example.com/new"]).toEqual({
      filename: "new-note",
      gleaned: "2025-06-15",
      updated: "2025-06-15",
    });
    // Old entry should still exist.
    expect(writtenJson["https://example.com/old"]).toBeDefined();
  });

  // --- findExistingNote ------------------------------------------------------

  it("finds existing note by URL", async () => {
    const indexData = {
      "https://example.com/article": {
        filename: "article",
        gleaned: "2025-06-15",
        updated: "2025-06-15",
      },
    };
    readFile.mockResolvedValueOnce(JSON.stringify(indexData));

    const result = await findExistingNote(
      "https://example.com/article",
      "/vault",
      "Glean",
    );

    expect(result).toEqual({
      filename: "article",
      gleaned: "2025-06-15",
      updated: "2025-06-15",
    });
  });

  it("returns null for unknown URL", async () => {
    const indexData = {
      "https://example.com/article": {
        filename: "article",
        gleaned: "2025-06-15",
        updated: "2025-06-15",
      },
    };
    readFile.mockResolvedValueOnce(JSON.stringify(indexData));

    const result = await findExistingNote(
      "https://example.com/unknown",
      "/vault",
      "Glean",
    );

    expect(result).toBeNull();
  });

  // --- readExistingMeta ------------------------------------------------------

  it("reads existing note metadata", async () => {
    const noteContent = [
      "---",
      "title: My Article",
      "url: https://example.com/article",
      "gleaned: 2025-06-15",
      "updated: 2025-06-15",
      "tags:",
      "  - glean",
      "---",
      "",
      "## Summary",
      "Some content here.",
    ].join("\n");

    readFile.mockResolvedValueOnce(noteContent);

    const meta = await readExistingMeta("/vault/Glean/my-article.md");

    expect(readFile).toHaveBeenCalledWith(
      "/vault/Glean/my-article.md",
      "utf-8",
    );
    expect(meta.title).toBe("My Article");
    expect(meta.url).toBe("https://example.com/article");
    expect(meta.gleaned).toBe("2025-06-15");
    expect(meta.tags).toEqual(["glean"]);
  });

  // --- deployBase ------------------------------------------------------------

  it("deploys base template if not exists", async () => {
    // First readFile call (checking if Glean.base exists) throws — file missing.
    readFile.mockRejectedValueOnce(enoentError());

    await deployBase("/vault", "Glean");

    expect(copyFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("templates", "base.yaml")),
      path.join("/vault", "Glean", "Glean.base"),
    );
  });
});
