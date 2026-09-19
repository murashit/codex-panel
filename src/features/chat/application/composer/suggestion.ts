import type { ThreadCommandTarget } from "../slash-commands/thread-arguments";
import type { ActiveNoteContextReference, SelectionContextReference } from "./context-references";

export interface ComposerSuggestion {
  display: string;
  detail: string;
  replacement: string;
  start: number;
  appendSpaceOnInsert?: boolean;
  tabCursorOffset?: number;
  suffixOnInsert?: string;
  activeNoteContext?: ActiveNoteContextReference;
  selectionContext?: SelectionContextReference;
  threadCommandTarget?: ThreadCommandTarget;
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
