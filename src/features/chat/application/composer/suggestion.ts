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
