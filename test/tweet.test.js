import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const { execSync } = await import("child_process");
const { composeTweet, openTweetIntent } = await import("../src/tweet.js");

describe("composeTweet", () => {
  it("returns summary + url when tweetSummary present", () => {
    const result = composeTweet("Great article", "https://example.com", "Title");
    expect(result).toBe("Great article https://example.com");
  });

  it("truncates text over 2000 chars with ellipsis", () => {
    const longSummary = "A".repeat(2500);
    const result = composeTweet(longSummary, "https://example.com");
    const textPart = result.split(" https://example.com")[0];
    expect(textPart.length).toBe(2000);
    expect(textPart.endsWith("...")).toBe(true);
  });

  it("falls back to title when tweetSummary missing", () => {
    const result = composeTweet(undefined, "https://example.com", "My Title");
    expect(result).toBe("My Title https://example.com");
  });

  it("returns just URL when both missing", () => {
    const result = composeTweet(undefined, "https://example.com");
    expect(result).toBe("https://example.com");
  });

  it("falls back to title when tweetSummary is empty string", () => {
    const result = composeTweet("", "https://example.com", "Fallback Title");
    expect(result).toBe("Fallback Title https://example.com");
  });
});

describe("openTweetIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls execSync with correct intent URL", () => {
    openTweetIntent("Hello world https://example.com");

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("https://x.com/intent/tweet?text="),
    );
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("Hello world https://example.com")),
    );
  });

  it("logs URL on failure instead of throwing", () => {
    execSync.mockImplementation(() => {
      throw new Error("open failed");
    });

    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => openTweetIntent("test")).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://x.com/intent/tweet?text="),
    );

    stderrSpy.mockRestore();
  });
});
