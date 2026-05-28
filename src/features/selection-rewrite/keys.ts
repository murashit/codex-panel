import type { ComposerSendKeyEvent } from "../../shared/ui/keyboard";

export function isSelectionRewriteActionKey(event: ComposerSendKeyEvent): boolean {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey || event.altKey) return false;
  return true;
}
