import type { ThreadItem as GeneratedTurnItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn as GeneratedTurnRecord } from "../../generated/app-server/v2/Turn";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import {
  conversationSummaryFromTranscriptEntries,
  nonEmptyConversationSummaries,
  type ThreadConversationSummary,
  type ThreadTranscriptEntry,
} from "../../domain/threads/transcript";

export type TurnItem = GeneratedTurnItem;
export type TurnRecord = GeneratedTurnRecord;

export function transcriptEntriesFromTurnRecord(turn: TurnRecord): ThreadTranscriptEntry[] {
  return turn.items.flatMap((item) => transcriptEntriesFromTurnItem(item, turn));
}

export function transcriptEntriesFromTurnRecords(turns: readonly TurnRecord[]): ThreadTranscriptEntry[] {
  return turns.flatMap(transcriptEntriesFromTurnRecord);
}

function conversationSummaryFromTurnRecord(turn: TurnRecord): ThreadConversationSummary {
  return conversationSummaryFromTranscriptEntries(transcriptEntriesFromTurnRecord(turn));
}

export function conversationAssistantTextFromTurnRecord(turn: TurnRecord): string | null {
  return conversationSummaryFromTurnRecord(turn).assistantText;
}

export function completedConversationSummaryFromTurnRecord(turn: TurnRecord): ThreadConversationSummary | null {
  if (turn.status !== "completed") return null;
  const summary = conversationSummaryFromTurnRecord(turn);
  return summary.userText && summary.assistantText ? summary : null;
}

export function completedConversationSummariesFromTurnRecords(turns: readonly TurnRecord[]): ThreadConversationSummary[] {
  return turns.flatMap((turn) => {
    const summary = completedConversationSummaryFromTurnRecord(turn);
    return summary ? [summary] : [];
  });
}

function conversationSummariesFromTurnRecords(turns: readonly TurnRecord[]): ThreadConversationSummary[] {
  return nonEmptyConversationSummaries(turns.map(conversationSummaryFromTurnRecord));
}

export function chronologicalConversationSummariesFromTurnRecords(turns: readonly TurnRecord[]): ThreadConversationSummary[] {
  return conversationSummariesFromTurnRecords(chronologicalTurnRecords(turns));
}

export function turnUserItemText(item: Extract<TurnItem, { type: "userMessage" }>): string {
  return userInputText(item.content);
}

export function lastAgentMessageTextFromTurnRecord(turn: TurnRecord): string | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item === undefined) continue;
    if (item.type !== "agentMessage") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}

function transcriptEntriesFromTurnItem(item: TurnItem, turn: TurnRecord): ThreadTranscriptEntry[] {
  if (item.type === "userMessage") {
    const text = turnUserItemText(item).trim();
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

function userInputText(content: UserInput[]): string {
  const hasText = content.some((item) => item.type === "text" && item.text.length > 0);
  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      if (item.type === "localImage") return `[local image] ${item.path}`;
      if (item.type === "image") return `[image] ${item.url}`;
      if (item.type === "mention") return hasText ? "" : `[@${item.name}] ${item.path}`;
      return hasText ? "" : `[$${item.name}] ${item.path}`;
    })
    .filter(Boolean)
    .join("\n");
}

function chronologicalTurnRecords(turns: readonly TurnRecord[]): TurnRecord[] {
  return [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}
