import type { EditorPosition } from "obsidian";
import type { ReasoningEffort } from "../../domain/catalog/metadata";

type SelectionRewriteStatus = SelectionRewriteState["status"];
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
        status: "editing-prompt";
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
    | {
        status: "cancelled";
        streamText: string;
        replacementText: string | null;
        debugText: string | null;
      }
    | {
        status: "applied";
        streamText: string;
        replacementText: string | null;
        debugText: string | null;
      }
  );

export interface SelectionRewriteRuntimeSettings {
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
}

export type SelectionRewriteLifecycleEvent =
  | { type: "generation-started"; instruction: string }
  | { type: "preview-updated"; text: string }
  | { type: "generation-succeeded"; replacementText: string }
  | { type: "generation-failed"; debugText: string | null }
  | { type: "cancelled" }
  | { type: "applied" };

type SelectionRewriteLifecycleEventType = SelectionRewriteLifecycleEvent["type"];
type SelectionRewriteLifecycleTransition = (state: SelectionRewriteState, event: SelectionRewriteLifecycleEvent) => SelectionRewriteState;
type SelectionRewriteLifecycleTransitionTable = Record<
  SelectionRewriteStatus,
  Record<SelectionRewriteLifecycleEventType, SelectionRewriteLifecycleTransition>
>;

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

export function transitionSelectionRewriteState(
  state: SelectionRewriteState,
  event: SelectionRewriteLifecycleEvent,
): SelectionRewriteState {
  return selectionRewriteLifecycleTransitions[state.status][event.type](state, event);
}

const keepSelectionRewriteState: SelectionRewriteLifecycleTransition = (state) => state;

const generationStartedTransition: SelectionRewriteLifecycleTransition = (state, event) => ({
  ...selectionRewriteBaseState(state),
  instruction: requireGenerationInstruction(event),
  status: "generating",
  streamText: "",
  replacementText: null,
  debugText: null,
});

const previewUpdatedTransition: SelectionRewriteLifecycleTransition = (state, event) => ({
  ...selectionRewriteBaseState(state),
  status: "generating",
  streamText: requirePreviewText(event),
  replacementText: null,
  debugText: null,
});

const generationSucceededTransition: SelectionRewriteLifecycleTransition = (state, event) => ({
  ...selectionRewriteBaseState(state),
  status: "preview",
  streamText: "",
  replacementText: requireReplacementText(event),
  debugText: null,
});

const generationFailedTransition: SelectionRewriteLifecycleTransition = (state, event) => ({
  ...selectionRewriteBaseState(state),
  status: "failed",
  streamText: "",
  replacementText: null,
  debugText: optionalDebugText(event),
});

const cancelledTransition: SelectionRewriteLifecycleTransition = (state) => ({
  ...selectionRewriteBaseState(state),
  status: "cancelled",
  streamText: state.streamText,
  replacementText: state.replacementText,
  debugText: state.debugText,
});

const appliedTransition: SelectionRewriteLifecycleTransition = (state) => ({
  ...selectionRewriteBaseState(state),
  status: "applied",
  streamText: state.streamText,
  replacementText: state.replacementText,
  debugText: state.debugText,
});

const editableSelectionRewriteTransitions = {
  "generation-started": generationStartedTransition,
  "preview-updated": keepSelectionRewriteState,
  "generation-succeeded": keepSelectionRewriteState,
  "generation-failed": keepSelectionRewriteState,
  cancelled: cancelledTransition,
  applied: appliedTransition,
} satisfies Record<SelectionRewriteLifecycleEventType, SelectionRewriteLifecycleTransition>;

const terminalSelectionRewriteTransitions = {
  "generation-started": keepSelectionRewriteState,
  "preview-updated": keepSelectionRewriteState,
  "generation-succeeded": keepSelectionRewriteState,
  "generation-failed": keepSelectionRewriteState,
  cancelled: cancelledTransition,
  applied: appliedTransition,
} satisfies Record<SelectionRewriteLifecycleEventType, SelectionRewriteLifecycleTransition>;

const selectionRewriteLifecycleTransitions: SelectionRewriteLifecycleTransitionTable = {
  "editing-prompt": editableSelectionRewriteTransitions,
  generating: {
    "generation-started": generationStartedTransition,
    "preview-updated": previewUpdatedTransition,
    "generation-succeeded": generationSucceededTransition,
    "generation-failed": generationFailedTransition,
    cancelled: cancelledTransition,
    applied: appliedTransition,
  },
  preview: editableSelectionRewriteTransitions,
  failed: editableSelectionRewriteTransitions,
  cancelled: terminalSelectionRewriteTransitions,
  applied: terminalSelectionRewriteTransitions,
};

function requireGenerationInstruction(event: SelectionRewriteLifecycleEvent): string {
  if ("instruction" in event) return event.instruction;
  throw new Error(`Selection rewrite lifecycle event ${event.type} does not include an instruction.`);
}

function requirePreviewText(event: SelectionRewriteLifecycleEvent): string {
  if ("text" in event) return event.text;
  throw new Error(`Selection rewrite lifecycle event ${event.type} does not include preview text.`);
}

function requireReplacementText(event: SelectionRewriteLifecycleEvent): string {
  if ("replacementText" in event) return event.replacementText;
  throw new Error(`Selection rewrite lifecycle event ${event.type} does not include replacement text.`);
}

function optionalDebugText(event: SelectionRewriteLifecycleEvent): string | null {
  return "debugText" in event ? event.debugText : null;
}

function selectionRewriteBaseState(state: SelectionRewriteState): SelectionRewriteBaseState {
  return {
    filePath: state.filePath,
    targetRange: state.targetRange,
    originalText: state.originalText,
    noteText: state.noteText,
    instruction: state.instruction,
  };
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
