import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises for resolveUniqueFilename.
vi.mock("fs/promises", () => ({
  access: vi.fn(),
}));

const { access } = await import("fs/promises");

const {
  validateUrl,
  sanitiseFilename,
  resolveUniqueFilename,
  normaliseUrl,
  formatDate,
  truncateContent,
} = await import("../src/utils.js");

// --- Tests -------------------------------------------------------------------

describe("validateUrl", () => {
  it("validates http URLs", () => {
    expect(validateUrl("http://example.com")).toBe(true);
  });

  it("validates https URLs", () => {
    expect(validateUrl("https://example.com/path")).toBe(true);
  });

  it("rejects invalid URLs", () => {
    expect(validateUrl("not-a-url")).toBe(false);
  });

  it("rejects ftp URLs", () => {
    expect(validateUrl("ftp://example.com")).toBe(false);
  });
});

describe("sanitiseFilename", () => {
  it("converts spaces to hyphens", () => {
    const result = sanitiseFilename("Hello World");
    expect(result).toContain("-");
    expect(result).not.toContain(" ");
    expect(result).toBe("hello-world");
  });

  it("removes special chars", () => {
    const result = sanitiseFilename('Hello: A "Test"!');
    expect(result).not.toMatch(/[:"!]/);
    expect(result).toBe("hello-a-test");
  });

  it("truncates to 80 chars", () => {
    const longTitle =
      "This is a very long title that should definitely exceed eighty characters when converted to a filename with hyphens";
    const result = sanitiseFilename(longTitle);
    expect(result.length).toBeLessThanOrEqual(80);
  });
});

describe("resolveUniqueFilename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves unique filename", async () => {
    // First access call succeeds — file exists.
    access.mockResolvedValueOnce(undefined);
    // Second access call throws — file does not exist (name is available).
    access.mockRejectedValueOnce(new Error("ENOENT"));

    const result = await resolveUniqueFilename("my-note", "/vault/Glean");

    expect(result).toBe("my-note-2");
  });
});

describe("normaliseUrl", () => {
  it("removes trailing slash", () => {
    const result = normaliseUrl("https://example.com/path/");
    expect(result).not.toMatch(/\/$/);
    expect(result).toBe("https://example.com/path");
  });

  it("removes fragment", () => {
    const result = normaliseUrl("https://example.com/page#section");
    expect(result).not.toContain("#section");
    expect(result).toBe("https://example.com/page");
  });

  it("lowercases host", () => {
    const result = normaliseUrl("https://EXAMPLE.COM/Path");
    expect(result).toContain("example.com");
    // Path case should be preserved.
    expect(result).toContain("/Path");
  });
});

describe("formatDate", () => {
  it("formats date as YYYY-MM-DD", () => {
    const result = formatDate(new Date("2025-06-15T00:00:00Z"));
    expect(result).toBe("2025-06-15");
  });

  it("formats today's date when no arg", () => {
    const result = formatDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("truncateContent", () => {
  it("truncates long content", () => {
    const long = "x".repeat(200);
    const result = truncateContent(long, 100);

    // First 100 chars of content + the truncation notice.
    expect(result).toContain("[Content truncated for length]");
    expect(result.length).toBeGreaterThan(100);
    expect(result.length).toBeLessThan(200);
  });

  it("does not truncate short content", () => {
    const result = truncateContent("short", 100);
    expect(result).toBe("short");
  });
});
