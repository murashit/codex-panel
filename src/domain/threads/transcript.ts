import type { ThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn } from "../../generated/app-server/v2/Turn";
import { inputToText } from "./user-input-text";

type TranscriptEntryKind = "user" | "assistant" | "plan";

export interface TurnTranscriptEntry {
  kind: TranscriptEntryKind;
  text: string;
  timestamp: number | null;
}

export interface TurnConversationSummary {
  userText: string | null;
  assistantText: string | null;
}

export function turnTranscriptEntries(turn: Turn): TurnTranscriptEntry[] {
  return turn.items.flatMap((item) => transcriptEntriesFromItem(item, turn));
}

export function chronologicalTurnConversationSummaries(turns: readonly Turn[]): TurnConversationSummary[] {
  return chronologicalTurns(turns)
    .map(turnConversationSummary)
    .filter((summary) => summary.userText !== null || summary.assistantText !== null);
}

export function completedTurnConversationSummary(turn: Turn): TurnConversationSummary | null {
  if (turn.status !== "completed") return null;
  const summary = turnConversationSummary(turn);
  return summary.userText && summary.assistantText ? summary : null;
}

export function turnConversationSummary(turn: Turn): TurnConversationSummary {
  return {
    userText: firstUserText(turn.items),
    assistantText: lastAssistantText(turn.items),
  };
}

export function userItemText(item: Extract<ThreadItem, { type: "userMessage" }>): string {
  return inputToText(item.content);
}

function transcriptEntriesFromItem(item: ThreadItem, turn: Turn): TurnTranscriptEntry[] {
  if (item.type === "userMessage") {
    const text = userItemText(item).trim();
    return text ? [{ kind: "user", text, timestamp: turn.startedAt }] : [];
  }
  if (item.type === "agentMessage") {
    const text = item.text.trim();
    return text ? [{ kind: "assistant", text, timestamp: turn.completedAt ?? turn.startedAt }] : [];
  }
  if (item.type === "plan") {
    const text = item.text.trim();
    return text ? [{ kind: "plan", text, timestamp: turn.completedAt ?? turn.startedAt }] : [];
  }
  return [];
}

function chronologicalTurns(turns: readonly Turn[]): Turn[] {
  return [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

function firstUserText(items: readonly ThreadItem[]): string | null {
  for (const item of items) {
    if (item.type !== "userMessage") continue;
    const text = userItemText(item).trim();
    if (text) return text;
  }
  return null;
}

function lastAssistantText(items: readonly ThreadItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) continue;
    if (item.type !== "agentMessage" && item.type !== "plan") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}
