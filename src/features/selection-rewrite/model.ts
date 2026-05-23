import type { EditorPosition } from "obsidian";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";

export type SelectionRewriteStatus = "editing-prompt" | "generating" | "preview" | "applied" | "cancelled" | "failed";

export interface SelectionRewriteSession {
  filePath: string;
  targetRange: {
    from: EditorPosition;
    to: EditorPosition;
  };
  originalText: string;
  noteText: string;
  instruction: string;
  status: SelectionRewriteStatus;
  streamText: string;
  replacementText: string | null;
  debugText: string | null;
}

export interface SelectionRewriteRuntimeSettings {
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
}

export function canApplySelectionRewrite(currentText: string, originalText: string): boolean {
  return currentText === originalText;
}
