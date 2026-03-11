import readline from "readline/promises";
import { clearJobs } from "../queue.js";

/**
 * Clear jobs from the queue.
 *
 * @param {object} options
 * @param {boolean} [options.failed] - Only clear failed jobs.
 * @param {boolean} [options.all] - Clear all jobs (requires confirmation).
 */
export async function clearHistory(options = {}) {
  if (options.all) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      const answer = await rl.question(
        "This will delete ALL jobs including pending ones. Continue? (y/N) ",
      );
      rl.close();

      if (answer.trim().toLowerCase() !== "y") {
        console.log("Aborted.");
        return;
      }
    }

    const count = clearJobs("all");
    console.log(`Cleared ${count} job(s).`);
    return;
  }

  if (options.failed) {
    const count = clearJobs("failed");
    console.log(`Cleared ${count} failed job(s).`);
    return;
  }

  // Default: clear completed + failed.
  const count = clearJobs("completed");
  console.log(`Cleared ${count} completed/failed job(s).`);
}
