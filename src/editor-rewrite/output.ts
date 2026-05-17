import type { Turn } from "../generated/app-server/v2/Turn";

export interface RewriteOutput {
  replacementText: string;
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
  const text = lastAgentMessageText(turn);
  return text ? parseRewriteOutput(text) : null;
}

function lastAgentMessageText(turn: Turn): string | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.type !== "agentMessage") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}
