import { showHUD, showToast, Toast } from "@raycast/api";
import { execGlean } from "./lib/exec-glean";

export default async function Command() {
  try {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Clearing queue...",
    });

    const { stdout } = await execGlean(["clear"]);
    const message = stdout.trim() || "Queue cleared";

    toast.hide();
    await showHUD(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Clear Failed",
      message,
    });
  }
}
