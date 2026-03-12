import { List, ActionPanel, Action, Icon, Color, showToast, Toast } from "@raycast/api";
import { useSQL } from "@raycast/utils";
import path from "path";
import os from "os";
import { Job, ExtractedData } from "./lib/types";
import { execGlean } from "./lib/exec-glean";
import { loadGleanConfig } from "./lib/config";

const DB_PATH = path.join(os.homedir(), ".glean", "glean.db");

const QUERY = `SELECT id, url, extracted_data, status, error_message, result_filename, result_path, attempts, max_attempts, created_at, completed_at FROM jobs ORDER BY created_at DESC LIMIT 50`;

const STATUS_ORDER: Job["status"][] = ["pending", "processing", "failed", "completed"];

const STATUS_META: Record<Job["status"], { icon: Icon; color: Color }> = {
  pending: { icon: Icon.Clock, color: Color.Blue },
  processing: { icon: Icon.ArrowClockwise, color: Color.Orange },
  completed: { icon: Icon.Checkmark, color: Color.Green },
  failed: { icon: Icon.XMarkCircle, color: Color.Red },
};

function relativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function extractTitle(job: Job): string {
  try {
    const data: ExtractedData = JSON.parse(job.extracted_data);
    if (data.title) return data.title;
  } catch {
    // fall through
  }
  try {
    return new URL(job.url).hostname;
  } catch {
    return job.url;
  }
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function Command() {
  const config = loadGleanConfig();
  const { data, isLoading, error, revalidate } = useSQL<Job>(DB_PATH, QUERY);

  if (error) {
    return (
      <List>
        <List.EmptyView title="No jobs yet" description="Glean a URL to get started." icon={Icon.Tray} />
      </List>
    );
  }

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    jobs: (data ?? []).filter((job) => job.status === status),
  })).filter((group) => group.jobs.length > 0);

  async function retryJob(jobId: string) {
    try {
      await showToast({ style: Toast.Style.Animated, title: "Retrying job..." });
      await execGlean(["retry", jobId]);
      await showToast({ style: Toast.Style.Success, title: "Job queued for retry" });
      revalidate();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await showToast({ style: Toast.Style.Failure, title: "Retry Failed", message });
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter jobs...">
      {grouped.map(({ status, jobs }) => (
        <List.Section key={status} title={status.charAt(0).toUpperCase() + status.slice(1)} subtitle={`${jobs.length}`}>
          {jobs.map((job) => {
            const meta = STATUS_META[job.status];
            return (
              <List.Item
                key={job.id}
                icon={{ source: meta.icon, tintColor: meta.color }}
                title={extractTitle(job)}
                subtitle={extractHostname(job.url)}
                accessories={[
                  { text: relativeTime(job.created_at) },
                  { tag: { value: job.status, color: meta.color } },
                ]}
                actions={
                  <ActionPanel>
                    {job.status === "completed" && job.result_filename && (
                      <Action.Open
                        title="Open Note in Obsidian"
                        target={`obsidian://open?vault=${encodeURIComponent(config.vault)}&file=${encodeURIComponent(job.result_filename)}`}
                      />
                    )}
                    {job.status === "completed" && (
                      <Action.OpenInBrowser title="Open Source URL" url={job.url} />
                    )}
                    {job.status === "failed" && (
                      <Action
                        title="Retry Job"
                        icon={Icon.ArrowClockwise}
                        onAction={() => retryJob(job.id)}
                      />
                    )}
                    <Action.OpenInBrowser title="Open Source URL" url={job.url} />
                    <Action.CopyToClipboard title="Copy Job ID" content={job.id} />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
      {!isLoading && (data ?? []).length === 0 && (
        <List.EmptyView title="No jobs yet" description="Glean a URL to get started." icon={Icon.Tray} />
      )}
    </List>
  );
}
