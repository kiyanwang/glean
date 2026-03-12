import { Form, ActionPanel, Action, showToast, Toast, showHUD, popToRoot } from "@raycast/api";
import { useState, useEffect } from "react";
import { resolveUrl } from "./lib/url-source";
import { buildGleanArgs, execGlean } from "./lib/exec-glean";
import { loadGleanConfig } from "./lib/config";

const MODELS = [
  { title: "Haiku", value: "haiku" },
  { title: "Sonnet", value: "sonnet" },
  { title: "Opus", value: "opus" },
];

export default function Command() {
  const config = loadGleanConfig();
  const categories = [
    { title: "Auto-detect", value: "" },
    ...config.categories.map((c) => ({
      title: c.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      value: c,
    })),
  ];

  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    resolveUrl()
      .then((resolved) => setUrl(resolved))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSubmit(values: {
    url: string;
    category: string;
    tags: string;
    model: string;
    open: boolean;
    update: boolean;
  }) {
    try {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: "Gleaning...",
        message: new URL(values.url).hostname,
      });

      const args = buildGleanArgs(values.url, {
        category: values.category || undefined,
        tags: values.tags || undefined,
        update: values.update,
        open: values.open,
        model: values.model || undefined,
      });

      const { stderr } = await execGlean(args);

      const queuedLine = stderr.split("\n").find((line) => line.startsWith("Queued: "));
      const title = queuedLine ? queuedLine.replace("Queued: ", "") : new URL(values.url).hostname;

      toast.hide();
      await showHUD(`Queued: ${title}`);
      await popToRoot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Glean Failed",
        message,
      });
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Glean URL" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="url" title="URL" placeholder="https://example.com/article" value={url} onChange={setUrl} />
      <Form.Dropdown id="category" title="Category" defaultValue="">
        {categories.map((cat) => (
          <Form.Dropdown.Item key={cat.value} title={cat.title} value={cat.value} />
        ))}
      </Form.Dropdown>
      <Form.TextField id="tags" title="Additional Tags" placeholder="comma-separated" />
      <Form.Dropdown id="model" title="Model" defaultValue={config.model || "haiku"}>
        {MODELS.map((m) => (
          <Form.Dropdown.Item key={m.value} title={m.title} value={m.value} />
        ))}
      </Form.Dropdown>
      <Form.Checkbox id="open" label="Open in Obsidian" defaultValue={false} />
      <Form.Checkbox id="update" label="Update existing note" defaultValue={false} />
    </Form>
  );
}
