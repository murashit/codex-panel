import type { EditorPosition } from "obsidian";
import type { ReasoningEffort } from "../../runtime/models";

type SelectionRewriteStatus = SelectionRewriteState["status"];
const TERMINAL_SELECTION_REWRITE_STATUSES = new Set<SelectionRewriteStatus>(["applied", "cancelled"]);

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

export function canApplySelectionRewrite(currentText: string, originalText: string): boolean {
  return currentText === originalText;
}

export function transitionSelectionRewriteState(
  state: SelectionRewriteState,
  event: SelectionRewriteLifecycleEvent,
): SelectionRewriteState {
  switch (event.type) {
    case "generation-started":
      if (TERMINAL_SELECTION_REWRITE_STATUSES.has(state.status)) return state;
      return {
        ...state,
        instruction: event.instruction,
        status: "generating",
        streamText: "",
        replacementText: null,
        debugText: null,
      };
    case "preview-updated":
      if (state.status !== "generating") return state;
      return { ...state, streamText: event.text };
    case "generation-succeeded":
      if (state.status !== "generating") return state;
      return {
        ...state,
        status: "preview",
        streamText: "",
        replacementText: event.replacementText,
      };
    case "generation-failed":
      if (state.status !== "generating") return state;
      return {
        ...state,
        status: "failed",
        streamText: "",
        debugText: event.debugText,
      };
    case "cancelled":
      return {
        ...state,
        status: "cancelled",
      };
    case "applied":
      return {
        ...state,
        status: "applied",
      };
  }
}
