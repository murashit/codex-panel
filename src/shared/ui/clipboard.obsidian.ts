import { Notice } from "obsidian";

export async function copyTextWithNotice(text: string, successMessage: string, failureMessage: string): Promise<void> {
  try {
    const clipboard = (navigator as { clipboard?: { writeText?: (value: string) => Promise<void> } }).clipboard;
    if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard API is not available.");
    await clipboard.writeText(text);
    new Notice(successMessage);
  } catch {
    new Notice(failureMessage);
  }
}
