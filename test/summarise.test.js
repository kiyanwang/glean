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
    spawnSync: vi.fn(),
  };
});

const { spawnSync } = await import("child_process");
const { summariseContent, MODEL_MAP } = await import("../src/summarise.js");

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

function makeSuccessResult(data) {
  return {
    stdout: JSON.stringify({
      type: "result",
      structured_output: data,
    }),
    stderr: "",
    status: 0,
    signal: null,
    error: null,
  };
}

// --- Tests -------------------------------------------------------------------

describe("summariseContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds correct prompt and passes it via stdin", () => {
    spawnSync.mockReturnValue(makeSuccessResult(claudeResponse));

    summariseContent(extractedData);

    expect(spawnSync).toHaveBeenCalledTimes(1);

    // The args array is the second argument to spawnSync.
    const args = spawnSync.mock.calls[0][1];
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--json-schema");
    expect(args).toContain("--model");
    expect(args).toContain("haiku");

    // The prompt is passed as `input` in the options (3rd argument).
    const options = spawnSync.mock.calls[0][2];
    expect(options.input).toContain(extractedData.title);
    expect(options.input).toContain(extractedData.author);
    expect(options.input).toContain(extractedData.url);
  });

  it("parses valid Claude JSON response", () => {
    spawnSync.mockReturnValue(makeSuccessResult(claudeResponse));

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
    spawnSync.mockReturnValue({
      stdout: "",
      stderr: "",
      status: null,
      signal: "SIGTERM",
      error: null,
    });

    expect(() => summariseContent(extractedData)).toThrow("Claude CLI timed out");
  });

  it("handles Claude CLI not found", () => {
    spawnSync.mockReturnValue({
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
      error: { code: "ENOENT" },
    });

    expect(() => summariseContent(extractedData)).toThrow("Claude CLI not found");
  });

  it("validates response has required fields", () => {
    // Return envelope missing the 'summary' field.
    const incomplete = { ...claudeResponse };
    delete incomplete.summary;
    spawnSync.mockReturnValue(makeSuccessResult(incomplete));

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
    spawnSync.mockReturnValue({
      stdout: JSON.stringify(envelope),
      stderr: "",
      status: 0,
      signal: null,
      error: null,
    });

    const result = summariseContent(extractedData);

    expect(result.title).toBe(claudeResponse.title);
    expect(result.category).toBe(claudeResponse.category);
  });

  it("unwraps Claude CLI envelope with result as JSON string", () => {
    const envelope = {
      type: "result",
      result: JSON.stringify(claudeResponse),
    };
    spawnSync.mockReturnValue({
      stdout: JSON.stringify(envelope),
      stderr: "",
      status: 0,
      signal: null,
      error: null,
    });

    const result = summariseContent(extractedData);

    expect(result.title).toBe(claudeResponse.title);
  });

  it("truncates very long content", () => {
    spawnSync.mockReturnValue(makeSuccessResult(claudeResponse));

    const longData = {
      ...extractedData,
      content: "x".repeat(200000),
    };

    // Should not throw — content gets truncated internally.
    const result = summariseContent(longData);
    expect(result.title).toBe(claudeResponse.title);
  });

  it("passes model parameter to CLI args", () => {
    spawnSync.mockReturnValue(makeSuccessResult(claudeResponse));

    summariseContent(extractedData, "sonnet");

    const args = spawnSync.mock.calls[0][1];
    expect(args).toContain("--model");
    const modelIndex = args.indexOf("--model");
    expect(args[modelIndex + 1]).toBe("sonnet");
  });

  it("passes through custom model names not in MODEL_MAP", () => {
    spawnSync.mockReturnValue(makeSuccessResult(claudeResponse));

    summariseContent(extractedData, "claude-3-5-sonnet-20241022");

    const args = spawnSync.mock.calls[0][1];
    const modelIndex = args.indexOf("--model");
    expect(args[modelIndex + 1]).toBe("claude-3-5-sonnet-20241022");
  });

  it("exports MODEL_MAP with valid shorthand names", () => {
    expect(MODEL_MAP).toEqual({
      haiku: "haiku",
      sonnet: "sonnet",
      opus: "opus",
    });
  });

  it("handles non-zero exit status", () => {
    spawnSync.mockReturnValue({
      stdout: "",
      stderr: "Some error occurred",
      status: 1,
      signal: null,
      error: null,
    });

    expect(() => summariseContent(extractedData)).toThrow(
      /Claude CLI failed.*Some error occurred/,
    );
  });
});
