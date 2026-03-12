import { showHUD, showToast, Toast, LaunchProps } from "@raycast/api";
import { resolveUrl } from "./lib/url-source";
import { buildGleanArgs, execGlean } from "./lib/exec-glean";

export default async function Command(props: LaunchProps<{ arguments: { url?: string } }>) {
  try {
    const url = await resolveUrl(props.arguments.url);
    const hostname = new URL(url).hostname;

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Gleaning...",
      message: hostname,
    });

    const args = buildGleanArgs(url, { tweet: true });
    const { stderr } = await execGlean(args);

    const queuedLine = stderr.split("\n").find((line) => line.startsWith("Queued: "));
    const title = queuedLine ? queuedLine.replace("Queued: ", "") : hostname;

    toast.hide();
    await showHUD(`Queued: ${title}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("Note already exists")) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Note Already Exists",
        message: "Re-run with --update to overwrite",
      });
    } else if (message.includes("Invalid URL")) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Invalid URL",
        message,
      });
    } else if (message.includes("ENOENT") || message.includes("not found")) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Glean Not Found",
        message: "Set the glean path in Raycast extension preferences",
      });
    } else {
      await showToast({
        style: Toast.Style.Failure,
        title: "Glean Failed",
        message,
      });
    }
  }
}
