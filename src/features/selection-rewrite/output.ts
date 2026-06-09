export interface SelectionRewriteOutput {
  replacementText: string;
}

export interface SelectionRewriteOutputParseResult {
  output: SelectionRewriteOutput | null;
  rawText: string | null;
}

export class SelectionRewriteOutputError extends Error {
  constructor(
    message: string,
    readonly rawText: string | null,
  ) {
    super(message);
    this.name = "SelectionRewriteOutputError";
  }
}

export function parseSelectionRewriteOutput(text: string): SelectionRewriteOutput | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const replacementText = (parsed as { replacementText?: unknown }).replacementText;
    if (typeof replacementText !== "string") return null;
    return { replacementText };
  } catch {
    return null;
  }
}

export function selectionRewriteOutputFromText(text: string | null): SelectionRewriteOutput | null {
  return selectionRewriteOutputParseResultFromText(text).output;
}

export function selectionRewriteOutputParseResultFromText(text: string | null): SelectionRewriteOutputParseResult {
  if (!text) return { output: null, rawText: null };
  return { output: parseSelectionRewriteOutput(text), rawText: text };
}
