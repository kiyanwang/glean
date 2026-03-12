import { Clipboard } from "@raycast/api";

/**
 * Validate that `text` is a well-formed HTTP(S) URL.
 *
 * @returns The normalised URL string, or `null` if invalid.
 */
function validateUrl(text: string | undefined | null): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    // Not a valid URL — fall through.
  }

  return null;
}

/**
 * Resolve the URL to glean using the following priority chain:
 *
 * 1. Explicit argument (e.g. typed into Raycast search bar).
 * 2. System clipboard contents.
 *
 * @param argumentUrl - Optional URL passed as a Raycast command argument.
 * @returns A validated `http:` or `https:` URL string.
 * @throws If no valid URL can be found from any source.
 */
export async function resolveUrl(argumentUrl?: string): Promise<string> {
  // 1. Explicit argument from the Raycast search bar.
  const fromArgument = validateUrl(argumentUrl);
  if (fromArgument) {
    return fromArgument;
  }

  // 2. Clipboard contents.
  try {
    const clipboardText = await Clipboard.readText();
    const fromClipboard = validateUrl(clipboardText);
    if (fromClipboard) {
      return fromClipboard;
    }
  } catch {
    // Clipboard access failed — continue.
  }

  throw new Error(
    "No valid URL found. Provide a URL argument, open a page in your browser, or copy a URL to the clipboard.",
  );
}
