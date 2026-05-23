import { isComposerSendKey, type ComposerSendKeyEvent } from "../chat/composer/keys";
import type { SendShortcut } from "../../settings/model";

export type SelectionRewriteGenerateKeyEvent = ComposerSendKeyEvent;

export function isSelectionRewriteGenerateKey(event: SelectionRewriteGenerateKeyEvent, shortcut: SendShortcut): boolean {
  return isComposerSendKey(event, shortcut);
}

export function isSelectionRewriteActionKey(event: SelectionRewriteGenerateKeyEvent): boolean {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey || event.altKey) return false;
  return true;
}
