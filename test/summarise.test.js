import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const claudeResponse = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-claude-response.json"), "utf-8"),
);

// --- Mocks -------------------------------------------------------------------

vi.mock("child_process", () => {
  return {
    execSync: vi.fn(),
  };
});

// Mock fs write/unlink so no real temp files are written during tests.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

const { execSync } = await import("child_process");
const { writeFileSync } = await import("fs");
const { summariseContent } = await import("../src/summarise.js");

// --- Helpers -----------------------------------------------------------------

const extractedData = {
  content: "Platform engineering has become a hot topic...",
  title: "Platform Prerequisites for Self-Service",
  author: "Martin Fowler",
  published: "2024-01-15",
  site: "martinfowler.com",
  wordCount: 3200,
  url: "https://martinfowler.com/articles/platform-prerequisites.html",
  description: "Organizations need several prerequisites",
  domain: "martinfowler.com",
  language: "en",
  favicon: "",
  image: "",
};

// --- Tests -------------------------------------------------------------------

describe("summariseContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds correct prompt from extracted data", () => {
    execSync.mockReturnValue(JSON.stringify(claudeResponse));

    summariseContent(extractedData);

    expect(execSync).toHaveBeenCalledTimes(1);

    // The command is the first argument to execSync.
    const command = execSync.mock.calls[0][0];
    expect(command).toContain("claude");
    expect(command).toContain("--output-format json");
    expect(command).toContain("--json-schema");

    // The prompt is written to a temp file via writeFileSync.
    // writeFileSync is called with (tmpFile, prompt, encoding).
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const prompt = writeFileSync.mock.calls[0][1];
    expect(prompt).toContain(extractedData.title);
    expect(prompt).toContain(extractedData.author);
    expect(prompt).toContain(extractedData.url);
  });

  it("parses valid Claude JSON response", () => {
    execSync.mockReturnValue(JSON.stringify(claudeResponse));

    const result = summariseContent(extractedData);

    expect(result.title).toBe(claudeResponse.title);
    expect(result.author).toBe(claudeResponse.author);
    expect(result.source).toBe(claudeResponse.source);
    expect(result.published).toBe(claudeResponse.published);
    expect(result.summary).toBe(claudeResponse.summary);
    expect(result.keyTakeaways).toEqual(claudeResponse.keyTakeaways);
    expect(result.topics).toEqual(claudeResponse.topics);
    expect(result.category).toBe(claudeResponse.category);
    expect(result.readingTimeMinutes).toBe(claudeResponse.readingTimeMinutes);
    expect(result.sentiment).toBe(claudeResponse.sentiment);
  });

  it("handles Claude CLI timeout", () => {
    const err = new Error("Command timed out");
    err.killed = true;
    err.signal = "SIGTERM";
    execSync.mockImplementation(() => {
      throw err;
    });

    expect(() => summariseContent(extractedData)).toThrow("Claude CLI timed out");
  });

  it("handles Claude CLI not found", () => {
    const err = new Error("spawn claude ENOENT");
    err.code = "ENOENT";
    execSync.mockImplementation(() => {
      throw err;
    });

    expect(() => summariseContent(extractedData)).toThrow("Claude CLI not found");
  });

  it("validates response has required fields", () => {
    // Return JSON missing the 'summary' field.
    const incomplete = { ...claudeResponse };
    delete incomplete.summary;
    execSync.mockReturnValue(JSON.stringify(incomplete));

    expect(() => summariseContent(extractedData)).toThrow(
      /missing required fields.*summary/i,
    );
  });

  it("unwraps Claude CLI envelope with structured_output", () => {
    const envelope = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      structured_output: claudeResponse,
    };
    execSync.mockReturnValue(JSON.stringify(envelope));

    const result = summariseContent(extractedData);

    expect(result.title).toBe(claudeResponse.title);
    expect(result.category).toBe(claudeResponse.category);
  });

  it("unwraps Claude CLI envelope with result as JSON string", () => {
    const envelope = {
      type: "result",
      result: JSON.stringify(claudeResponse),
    };
    execSync.mockReturnValue(JSON.stringify(envelope));

    const result = summariseContent(extractedData);

    expect(result.title).toBe(claudeResponse.title);
  });

  it("truncates very long content", () => {
    execSync.mockReturnValue(JSON.stringify(claudeResponse));

    const longData = {
      ...extractedData,
      content: "x".repeat(200000),
    };

    // Should not throw — content gets truncated internally.
    const result = summariseContent(longData);
    expect(result.title).toBe(claudeResponse.title);
  });
});
