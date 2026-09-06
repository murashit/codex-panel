import { textareaCursorAtVisualBoundary } from "../../../../shared/dom/textarea-caret.measure";
import type { ComposerSuggestion } from "../../application/composer/suggestion";
import { syncComposerHeight } from "../../ui/composer/composer.dom";
import type { ThreadStreamScrollCommand } from "../../ui/thread-stream/flow-scroll.measure";

export type ComposerBoundaryScrollAction = Exclude<ThreadStreamScrollCommand, { kind: "show-latest" }>;

interface ComposerElementInsertion {
  value: string;
  cursor: number;
}

interface ComposerElementRangeInsertion {
  value: string;
  start: number;
  end: number;
}

export interface ComposerElementSelection extends ComposerElementRangeInsertion {
  direction: "forward" | "backward" | "none";
}

export function focusComposer(composer: HTMLTextAreaElement | null, options: { preventScroll?: boolean } = {}): void {
  composer?.focus(options);
}

export function composerHasFocus(composer: HTMLTextAreaElement | null): boolean {
  return composer !== null && composer.ownerDocument.activeElement === composer;
}

export function composerTextBeforeCursor(composer: HTMLTextAreaElement | null): string | null {
  if (!composer) return null;
  return composer.value.slice(0, composer.selectionStart);
}

export function composerSuggestionSignatureFromElement(composer: HTMLTextAreaElement | null): string | null {
  if (!composer) return null;
  return composerSuggestionSignature(composer.value, composer.selectionStart);
}

export function composerInsertionSource(composer: HTMLTextAreaElement | null): ComposerElementInsertion | null {
  if (!composer) return null;
  return {
    value: composer.value,
    cursor: composer.selectionStart,
  };
}

export function composerRangeInsertionSource(composer: HTMLTextAreaElement | null): ComposerElementRangeInsertion | null {
  if (!composer) return null;
  return {
    value: composer.value,
    start: composer.selectionStart,
    end: composer.selectionEnd,
  };
}

export function composerSelectionSource(composer: HTMLTextAreaElement | null): ComposerElementSelection | null {
  if (!composer) return null;
  return {
    value: composer.value,
    start: composer.selectionStart,
    end: composer.selectionEnd,
    direction: composer.selectionDirection,
  };
}

export function composerBoundaryScrollActionFromElement(
  event: KeyboardEvent,
  composer: HTMLTextAreaElement | null,
): ComposerBoundaryScrollAction | null {
  if (!composer || event.isComposing || event.metaKey || event.altKey || event.shiftKey) return null;
  const action = composerBoundaryScrollKeyAction(event);
  if (!action) return null;
  if (action.kind === "scroll-to" || action.amount === "page") return action;
  if (composer.selectionStart !== composer.selectionEnd) return null;
  const cursorAtTextBoundary =
    action.direction === -1
      ? !composer.value.slice(0, composer.selectionStart).includes("\n")
      : !composer.value.slice(composer.selectionEnd).includes("\n");
  return cursorAtTextBoundary && textareaCursorAtVisualBoundary(action.direction, composer) ? action : null;
}

function composerBoundaryScrollKeyAction(event: KeyboardEvent): ComposerBoundaryScrollAction | null {
  if (!event.ctrlKey) {
    if (event.key === "ArrowUp") return composerBoundaryScrollByAction(-1, "text-lines", event.repeat);
    if (event.key === "ArrowDown") return composerBoundaryScrollByAction(1, "text-lines", event.repeat);
    if (event.key === "PageUp") return composerBoundaryScrollByAction(-1, "page", event.repeat);
    if (event.key === "PageDown") return composerBoundaryScrollByAction(1, "page", event.repeat);
    if (event.key === "Home") return { kind: "scroll-to", edge: "start" };
    if (event.key === "End") return { kind: "scroll-to", edge: "end" };
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "p") return composerBoundaryScrollByAction(-1, "text-lines", event.repeat);
  if (key === "n") return composerBoundaryScrollByAction(1, "text-lines", event.repeat);
  return null;
}

function composerBoundaryScrollByAction(direction: -1 | 1, amount: "text-lines" | "page", repeat: boolean): ComposerBoundaryScrollAction {
  return repeat ? { kind: "scroll-by", direction, amount, repeated: true } : { kind: "scroll-by", direction, amount };
}

export function applyComposerInsertionToElement(composer: HTMLTextAreaElement | null, cursor: number): void {
  if (!composer) return;
  syncComposerHeight(composer);
  composer.focus();
  composer.setSelectionRange(cursor, cursor);
}

export function composerFilesFromTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const transfer = dataTransfer as Partial<DataTransfer>;
  const files = Array.from(transfer.files ?? []).filter((file) => file.size > 0);
  if (files.length > 0) return files;

  return Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .flatMap((item) => {
      const file = item.getAsFile();
      return file && file.size > 0 ? [file] : [];
    });
}

export function composerTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const transfer = dataTransfer as Partial<DataTransfer>;
  if (Array.from(transfer.types ?? []).includes("Files")) return true;
  if (Array.from(transfer.items ?? []).some((item) => item.kind === "file")) return true;
  return Array.from(transfer.files ?? []).some((file) => file.size > 0);
}

export function applyComposerSuggestionInsertion(
  value: string,
  cursor: number,
  suggestion: ComposerSuggestion,
  options: { activation?: "enter" | "tab" } = {},
): { value: string; cursor: number } {
  const suffix = value.slice(cursor);
  const appendSpace = suggestion.appendSpaceOnInsert === true && !suggestion.replacement.endsWith(" ") && !/^\s/.test(suffix);
  const replacement = `${suggestion.replacement}${appendSpace ? " " : ""}`;
  const suffixStart =
    cursor + (suggestion.suffixOnInsert && suffix.startsWith(suggestion.suffixOnInsert) ? suggestion.suffixOnInsert.length : 0);
  const nextValue = `${value.slice(0, suggestion.start)}${replacement}${value.slice(suffixStart)}`;
  const cursorOffset = options.activation === "tab" ? (suggestion.tabCursorOffset ?? 0) : 0;
  return { value: nextValue, cursor: suggestion.start + replacement.length + cursorOffset };
}

export function composerSuggestionNavigationDirection(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): 1 | -1 | null {
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "n") return 1;
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "p") return -1;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  return null;
}

export function nextComposerSuggestionIndex(current: number, length: number, direction: 1 | -1): number {
  if (length <= 0) return 0;
  return (current + direction + length) % length;
}

export function composerSuggestionSignature(value: string, cursor: number): string {
  return `${value}\u0000${String(cursor)}`;
}
