import type { EditorPosition } from "obsidian";

export type RewriteContextMode = "selection" | "note" | "note-and-thread";

export type RewriteStatus = "editing-prompt" | "generating" | "preview" | "applied" | "cancelled" | "failed";

export interface RewriteSession {
  filePath: string;
  targetRange: {
    from: EditorPosition;
    to: EditorPosition;
  };
  originalText: string;
  noteText: string;
  contextMode: RewriteContextMode;
  instruction: string;
  status: RewriteStatus;
  streamText: string;
  replacementText: string | null;
}

export function canApplyRewrite(currentText: string, originalText: string): boolean {
  return currentText === originalText;
}
