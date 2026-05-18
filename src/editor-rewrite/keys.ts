import { isComposerSendKey, type ComposerSendKeyEvent } from "../composer/keys";
import type { SendShortcut } from "../settings/model";

export type RewriteGenerateKeyEvent = ComposerSendKeyEvent;

export function isRewriteGenerateKey(event: RewriteGenerateKeyEvent, shortcut: SendShortcut): boolean {
  return isComposerSendKey(event, shortcut);
}
