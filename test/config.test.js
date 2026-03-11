import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "os";
import path from "path";

// Mock fs/promises and fs before importing the module under test.
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

vi.mock("fs", () => ({
  constants: { R_OK: 4 },
}));

const { readFile, access } = await import("fs/promises");

const { loadConfig } = await import("../src/config.js");

// --- Helpers -----------------------------------------------------------------

function enoentError() {
  const err = new Error("ENOENT: no such file or directory");
  err.code = "ENOENT";
  return err;
}

// --- Tests -------------------------------------------------------------------

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue(undefined);
  });

  it("loads config from default path", async () => {
    const userConfig = { vault: "My Vault", vaultPath: "/some/path" };
    readFile.mockResolvedValueOnce(JSON.stringify(userConfig));

    const config = await loadConfig();

    expect(readFile).toHaveBeenCalledWith(
      path.join(os.homedir(), ".gleanrc.json"),
      "utf-8",
    );
    expect(config.vault).toBe("My Vault");
  });

  it("loads config from custom path", async () => {
    const userConfig = { vault: "Custom Vault", vaultPath: "/custom/vault" };
    readFile.mockResolvedValueOnce(JSON.stringify(userConfig));

    const config = await loadConfig("/custom/path.json");

    expect(readFile).toHaveBeenCalledWith("/custom/path.json", "utf-8");
    expect(config.vault).toBe("Custom Vault");
  });

  it("applies defaults for missing fields", async () => {
    const userConfig = { vault: "My Vault" };
    readFile.mockResolvedValueOnce(JSON.stringify(userConfig));

    const config = await loadConfig();

    expect(config.vault).toBe("My Vault");
    expect(config.folder).toBe("Glean");
    expect(config.defaultTags).toEqual(["glean"]);
    expect(config.model).toBe("sonnet");
    expect(config.vaultPath).toBeNull();
    expect(config.categories).toEqual(expect.arrayContaining(["ai", "other"]));
  });

  it("handles missing config file gracefully", async () => {
    readFile.mockRejectedValueOnce(enoentError());

    const config = await loadConfig();

    // Should return all defaults without throwing.
    expect(config.vault).toBe("Knowledge Base");
    expect(config.folder).toBe("Glean");
    expect(config.defaultTags).toEqual(["glean"]);
    expect(config.model).toBe("sonnet");
    expect(config.vaultPath).toBeNull();
  });

  it("validates vaultPath exists", async () => {
    const userConfig = { vaultPath: "/does/not/exist" };
    readFile.mockResolvedValueOnce(JSON.stringify(userConfig));

    // access throws — path does not exist.
    access.mockRejectedValueOnce(enoentError());

    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = await loadConfig();

    // Should warn but not throw.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("/does/not/exist"),
    );
    expect(config.vaultPath).toBe("/does/not/exist");

    warnSpy.mockRestore();
  });

  it("merges config over defaults", async () => {
    const userConfig = { folder: "Articles" };
    readFile.mockResolvedValueOnce(JSON.stringify(userConfig));

    const config = await loadConfig();

    expect(config.folder).toBe("Articles");
    // Other defaults should be preserved.
    expect(config.vault).toBe("Knowledge Base");
    expect(config.defaultTags).toEqual(["glean"]);
    expect(config.model).toBe("sonnet");
  });
});
