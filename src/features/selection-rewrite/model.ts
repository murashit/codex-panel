import type { EditorPosition } from "obsidian";
import type { ReasoningEffort } from "../../domain/runtime/catalog";

export type SelectionRewriteInstructionHistoryDirection = -1 | 1;

export interface SelectionRewriteInput {
  readonly filePath: string;
  readonly targetRange: {
    readonly from: EditorPosition;
    readonly to: EditorPosition;
  };
  readonly selectionOffsets: { readonly from: number; readonly to: number };
  readonly originalText: string;
  readonly noteText: string;
}

export type SelectionRewriteState = Readonly<
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
>;

export interface SelectionRewriteRuntimeSettings {
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
}
