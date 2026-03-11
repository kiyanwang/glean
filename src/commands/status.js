import { getJobById, getJobSummary, getAllJobs } from "../queue.js";

/**
 * Display queue status.
 *
 * @param {string} [jobId] - If provided, show detail for this job.
 * @param {object} [options] - Command options.
 * @param {boolean} [options.all] - Show full history.
 */
export function showStatus(jobId, options = {}) {
  if (jobId) {
    return showJobDetail(jobId);
  }
  return showSummary(options);
}

function showJobDetail(jobId) {
  const job = getJobById(jobId);
  if (!job) {
    console.error(`No job found with ID: ${jobId}`);
    process.exit(1);
  }

  const extractedData = JSON.parse(job.extracted_data);
  const title = extractedData.title || "(no title)";

  console.log(`Job:       ${job.id}`);
  console.log(`URL:       ${job.url}`);
  console.log(`Title:     ${title}`);
  console.log(`Status:    ${job.status}`);
  console.log(`Attempts:  ${job.attempts}/${job.max_attempts}`);
  console.log(`Created:   ${job.created_at}`);

  if (job.started_at) {
    console.log(`Started:   ${job.started_at}`);
  }
  if (job.completed_at) {
    console.log(`Completed: ${job.completed_at}`);
  }
  if (job.result_path) {
    console.log(`Note:      ${job.result_path}`);
  }
  if (job.error_message) {
    console.log(`Error:     ${job.error_message}`);
  }
}

function showSummary(options) {
  const { counts, recent } = getJobSummary();

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total === 0) {
    console.log("No jobs in queue.");
    return;
  }

  console.log("Queue Status:");
  console.log(`  Pending:    ${counts.pending || 0}`);
  console.log(`  Processing: ${counts.processing || 0}`);
  console.log(`  Completed:  ${counts.completed || 0}`);
  console.log(`  Failed:     ${counts.failed || 0}`);
  console.log("");

  const items = options.all ? getAllJobs() : recent;
  const label = options.all ? "All Jobs:" : "Recent Jobs:";
  console.log(label);

  for (const job of items) {
    const status = job.status.padEnd(10);
    const id = job.id.slice(0, 8);
    const date = job.created_at;

    let display;
    try {
      const u = new URL(job.url);
      display = u.hostname + u.pathname.slice(0, 40);
    } catch {
      display = job.url.slice(0, 50);
    }

    const suffix = job.error_message ? ` (${job.error_message.slice(0, 40)})` : "";
    console.log(`  ${id}  ${status}  ${date}  ${display}${suffix}`);
  }
}
