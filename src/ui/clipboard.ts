import { Notice } from "obsidian";

export async function copyTextWithNotice(text: string, successMessage: string, failureMessage: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is not available.");
    await navigator.clipboard.writeText(text);
    new Notice(successMessage);
  } catch {
    new Notice(failureMessage);
  }
}
