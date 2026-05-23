import type { SendShortcut } from "../../../settings/model";

export interface ComposerSendKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

export function isComposerSendKey(event: ComposerSendKeyEvent, shortcut: SendShortcut): boolean {
  if (event.isComposing || event.key !== "Enter" || event.altKey) return false;
  if (shortcut === "mod-enter") return (event.metaKey || event.ctrlKey) && !event.shiftKey;
  return !event.metaKey && !event.ctrlKey && !event.shiftKey;
}
