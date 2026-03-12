import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { getPreferenceValues } from "@raycast/api";
import type { GleanPreferences } from "./types";

const execFileAsync = promisify(execFileCb);

/** Timeout for glean CLI invocations (30 seconds — async mode returns after extraction). */
const EXEC_TIMEOUT_MS = 30_000;

/** Maximum stdout/stderr buffer size (5 MB). */
const MAX_BUFFER = 5 * 1024 * 1024;

/**
 * Shell-escape a single argument for safe embedding in a shell command string.
 */
function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Execute a command through the user's login shell.
 *
 * Raycast provides a minimal environment that's missing PATH entries (nvm),
 * API keys, and auth config that glean and its background worker need.
 * Running through `zsh -l` loads the user's full shell profile.
 */
async function execLoginShell(
  cmd: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  const home = homedir();
  // Use `source ~/.zshrc` rather than `zsh -l` because login shell
  // initialisation (zprofile → zshrc) gets disrupted in minimal environments
  // (p10k/oh-my-zsh bail early), but an explicit source always works.
  const wrappedCmd = `source ~/.zshrc 2>/dev/null; ${cmd}`;

  try {
    const { stdout, stderr } = await execFileAsync(
      "/bin/zsh",
      ["-c", wrappedCmd],
      {
        timeout,
        maxBuffer: MAX_BUFFER,
        env: {
          ...process.env,
          HOME: home,
          USER: process.env.USER || homedir().split("/").pop() || "user",
        },
      },
    );
    return { stdout, stderr };
  } catch (error: unknown) {
    const execError = error as { stderr?: string; stdout?: string; message?: string; code?: string };
    const message = execError.stderr?.trim() || execError.message || String(error);
    const err = new Error(message);
    if (execError.code) {
      (err as NodeJS.ErrnoException).code = execError.code;
    }
    throw err;
  }
}

/**
 * Execute the glean CLI with the given arguments.
 *
 * Always runs through a login shell so glean (and the background worker
 * it spawns, which calls `claude`) inherits the full user environment.
 *
 * @param args - CLI arguments (e.g. `["https://example.com", "--sync"]`).
 * @returns The captured stdout and stderr.
 */
export async function execGlean(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const prefs = getPreferenceValues<GleanPreferences>();
  const binary = prefs.gleanPath || "glean";
  const cmd = [binary, ...args].map(shellEscape).join(" ");

  return execLoginShell(cmd, EXEC_TIMEOUT_MS);
}

/**
 * Construct the CLI argument array for a glean invocation.
 *
 * The glean CLI reads ~/.gleanrc.json for default settings (vault, folder,
 * model, tags, etc.), so we only pass per-invocation overrides here.
 *
 * @param url     - The URL to glean.
 * @param options - Optional per-invocation overrides from the Advanced form.
 * @returns An array of strings suitable for passing to {@link execGlean}.
 */
export function buildGleanArgs(
  url: string,
  options: {
    category?: string;
    tags?: string;
    model?: string;
    sync?: boolean;
    update?: boolean;
    open?: boolean;
  } = {},
): string[] {
  const args: string[] = [url];

  if (options.category) {
    args.push("--category", options.category);
  }
  if (options.tags) {
    args.push("--tags", options.tags);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.sync) {
    args.push("--sync");
  }
  if (options.open) {
    args.push("--open");
  }
  if (options.update) {
    args.push("--update");
  }

  return args;
}
