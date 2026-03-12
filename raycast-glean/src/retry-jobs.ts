import { showHUD, showToast, Toast } from "@raycast/api";
import { execGlean } from "./lib/exec-glean";

export default async function Command() {
  try {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Retrying failed jobs...",
    });

    const { stdout } = await execGlean(["retry"]);
    const message = stdout.trim() || "Retry command completed";

    toast.hide();
    await showHUD(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Retry Failed",
      message,
    });
  }
}
