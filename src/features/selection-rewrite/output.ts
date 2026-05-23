import type { Turn } from "../../generated/app-server/v2/Turn";

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

export function selectionRewriteOutputFromTurn(turn: Turn): SelectionRewriteOutput | null {
  return selectionRewriteOutputParseResultFromTurn(turn).output;
}

export function selectionRewriteOutputParseResultFromTurn(turn: Turn): SelectionRewriteOutputParseResult {
  const text = lastAgentMessageText(turn);
  if (!text) return { output: null, rawText: null };
  return { output: parseSelectionRewriteOutput(text), rawText: text };
}

function lastAgentMessageText(turn: Turn): string | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item === undefined) continue;
    if (item.type !== "agentMessage") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}
