import { isComposerSendKey, type ComposerSendKeyEvent } from "../chat/composer/keys";
import type { SendShortcut } from "../../settings/model";

export type RewriteGenerateKeyEvent = ComposerSendKeyEvent;

export function isRewriteGenerateKey(event: RewriteGenerateKeyEvent, shortcut: SendShortcut): boolean {
  return isComposerSendKey(event, shortcut);
}

export function isRewriteActionKey(event: RewriteGenerateKeyEvent): boolean {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey || event.altKey) return false;
  return true;
}
