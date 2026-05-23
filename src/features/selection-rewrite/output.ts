import type { Turn } from "../../generated/app-server/v2/Turn";

export interface RewriteOutput {
  replacementText: string;
}

export interface RewriteOutputParseResult {
  output: RewriteOutput | null;
  rawText: string | null;
}

export class RewriteOutputError extends Error {
  constructor(
    message: string,
    readonly rawText: string | null,
  ) {
    super(message);
    this.name = "RewriteOutputError";
  }
}

export function parseRewriteOutput(text: string): RewriteOutput | null {
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

export function rewriteOutputFromTurn(turn: Turn): RewriteOutput | null {
  return rewriteOutputParseResultFromTurn(turn).output;
}

export function rewriteOutputParseResultFromTurn(turn: Turn): RewriteOutputParseResult {
  const text = lastAgentMessageText(turn);
  if (!text) return { output: null, rawText: null };
  return { output: parseRewriteOutput(text), rawText: text };
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
