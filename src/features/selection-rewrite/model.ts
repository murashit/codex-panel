import type { EditorPosition } from "obsidian";
import type { ReasoningEffort } from "../../domain/runtime/catalog";

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

export interface SelectionRewriteRuntimeSettings {
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
}
