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

const mockParse = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn(() => ({
      messages: {
        parse: mockParse,
      },
    })),
  };
});

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

// --- Tests -------------------------------------------------------------------

describe("summariseContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key-123";
  });

  it("builds correct prompt from extracted data", async () => {
    mockParse.mockResolvedValue({ parsed_output: claudeResponse });

    await summariseContent(extractedData);

    expect(mockParse).toHaveBeenCalledTimes(1);

    const callArgs = mockParse.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe("user");
    expect(callArgs.messages[0].content).toContain(extractedData.title);
    expect(callArgs.messages[0].content).toContain(extractedData.author);
    expect(callArgs.messages[0].content).toContain(extractedData.url);
  });

  it("parses valid response", async () => {
    mockParse.mockResolvedValue({ parsed_output: claudeResponse });

    const result = await summariseContent(extractedData);

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

  it("maps model shorthand to full ID", async () => {
    mockParse.mockResolvedValue({ parsed_output: claudeResponse });

    await summariseContent(extractedData, "haiku");

    const callArgs = mockParse.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
  });

  it("uses custom model string as-is", async () => {
    mockParse.mockResolvedValue({ parsed_output: claudeResponse });

    await summariseContent(extractedData, "claude-sonnet-4-6");

    const callArgs = mockParse.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-6");
  });

  it("handles API error", async () => {
    mockParse.mockRejectedValue(new Error("Rate limit exceeded"));

    await expect(summariseContent(extractedData)).rejects.toThrow(
      "Anthropic API request failed: Rate limit exceeded",
    );
  });

  it("handles missing API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(summariseContent(extractedData)).rejects.toThrow(
      "ANTHROPIC_API_KEY environment variable is required",
    );
  });

  it("validates response has required fields", async () => {
    // parsed_output is null/undefined when validation fails
    mockParse.mockResolvedValue({ parsed_output: null });

    await expect(summariseContent(extractedData)).rejects.toThrow(
      /no parsed output/i,
    );
  });

  it("truncates very long content", async () => {
    mockParse.mockResolvedValue({ parsed_output: claudeResponse });

    const longData = {
      ...extractedData,
      content: "x".repeat(200000),
    };

    // Should not throw -- content gets truncated internally.
    const result = await summariseContent(longData);
    expect(result.title).toBe(claudeResponse.title);
  });

  it("exports MODEL_MAP with expected entries", () => {
    expect(MODEL_MAP.haiku).toBe("claude-haiku-4-5-20251001");
    expect(MODEL_MAP.sonnet).toBe("claude-sonnet-4-6");
    expect(MODEL_MAP.opus).toBe("claude-opus-4-6");
  });
});
