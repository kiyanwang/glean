import { retryJob, retryAllFailed } from "../queue.js";

/**
 * Retry failed job(s) and spawn the worker.
 *
 * @param {string} [jobId] - If provided, retry only this job. Otherwise retry all failed.
 * @param {Function} spawnWorkerFn - Function to spawn the background worker.
 */
export function retryJobs(jobId, spawnWorkerFn) {
  if (jobId) {
    const success = retryJob(jobId);
    if (success) {
      console.log(`Job ${jobId} reset to pending.`);
      spawnWorkerFn();
    } else {
      console.error(`No failed job found with ID: ${jobId}`);
      process.exit(1);
    }
  } else {
    const count = retryAllFailed();
    if (count > 0) {
      console.log(`Reset ${count} failed job(s) to pending.`);
      spawnWorkerFn();
    } else {
      console.log("No failed jobs to retry.");
    }
  }
}
