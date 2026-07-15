import type { EditorPosition } from "obsidian";
import type { ReasoningEffort } from "../../domain/catalog/metadata";

export type SelectionRewriteInstructionHistoryDirection = -1 | 1;

const APPLY_CONTEXT_RADIUS = 1_000;

interface SelectionRewriteTextRange {
  from: EditorPosition;
  to: EditorPosition;
}

interface SelectionRewriteBaseState {
  filePath: string;
  targetRange: {
    from: EditorPosition;
    to: EditorPosition;
  };
  originalText: string;
  noteText: string;
  instruction: string;
}

export type SelectionRewriteState = SelectionRewriteBaseState &
  (
    | {
        status: "editing";
        streamText: string;
        replacementText: null;
        debugText: null;
      }
    | {
        status: "generating";
        streamText: string;
        replacementText: null;
        debugText: null;
      }
    | {
        status: "preview";
        streamText: "";
        replacementText: string;
        debugText: null;
      }
    | {
        status: "failed";
        streamText: "";
        replacementText: null;
        debugText: string | null;
      }
  );

export interface SelectionRewriteRuntimeSettings {
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
}

export interface SelectionRewriteApplyContext {
  currentText: string;
  currentNoteText: string;
}

export interface SelectionRewriteTextRangeOffsets {
  from: number;
  to: number;
}

export function canApplySelectionRewrite(current: SelectionRewriteApplyContext, state: SelectionRewriteState): boolean {
  if (current.currentText !== state.originalText) return false;

  const originalOffsets = selectionRewriteTextRangeOffsets(state.noteText, state.targetRange, state.originalText);
  const currentOffsets = selectionRewriteTextRangeOffsets(current.currentNoteText, state.targetRange, state.originalText);
  if (!originalOffsets || !currentOffsets) return false;

  return (
    selectionRewriteRangeContextFingerprint(state.noteText, originalOffsets) ===
    selectionRewriteRangeContextFingerprint(current.currentNoteText, currentOffsets)
  );
}

export function selectionRewriteTextRangeOffsets(
  text: string,
  range: SelectionRewriteTextRange,
  expectedText?: string,
): SelectionRewriteTextRangeOffsets | null {
  const from = editorPositionOffset(text, range.from);
  const to = editorPositionOffset(text, range.to);
  if (from !== null && to !== null && to >= from) return { from, to };
  if (!expectedText) return null;

  const fallbackFrom = text.indexOf(expectedText);
  return fallbackFrom === -1 ? null : { from: fallbackFrom, to: fallbackFrom + expectedText.length };
}

function selectionRewriteRangeContextFingerprint(text: string, offsets: SelectionRewriteTextRangeOffsets): string {
  const beforeStart = Math.max(0, offsets.from - APPLY_CONTEXT_RADIUS);
  const afterEnd = Math.min(text.length, offsets.to + APPLY_CONTEXT_RADIUS);
  return `${text.slice(beforeStart, offsets.from)}\0${text.slice(offsets.to, afterEnd)}`;
}

function editorPositionOffset(text: string, position: EditorPosition): number | null {
  if (position.line < 0 || position.ch < 0) return null;
  let line = 0;
  let lineStart = 0;
  while (lineStart <= text.length) {
    if (line === position.line) {
      const lineEnd = text.indexOf("\n", lineStart);
      const end = lineEnd === -1 ? text.length : lineEnd;
      if (lineStart + position.ch > end) return null;
      return lineStart + position.ch;
    }
    const nextLine = text.indexOf("\n", lineStart);
    if (nextLine === -1) return null;
    line += 1;
    lineStart = nextLine + 1;
  }
  return null;
}
