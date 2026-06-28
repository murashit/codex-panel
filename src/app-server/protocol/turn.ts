import {
  conversationSummaryFromTranscriptEntries,
  nonEmptyConversationSummaries,
  type ThreadConversationSummary,
  type ThreadTranscriptEntry,
} from "../../domain/threads/transcript";
import type { ThreadItem as GeneratedThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn as GeneratedTurn } from "../../generated/app-server/v2/Turn";

export type TurnItem = GeneratedThreadItem;
export type TurnRecord = GeneratedTurn;

type AppServerUserInput = Extract<TurnItem, { type: "userMessage" }>["content"][number];

function transcriptEntriesFromTurnRecord(turn: TurnRecord): ThreadTranscriptEntry[] {
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

export function chronologicalConversationSummariesFromTurnRecords(turns: readonly TurnRecord[]): ThreadConversationSummary[] {
  return nonEmptyConversationSummaries(
    [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)).map(conversationSummaryFromTurnRecord),
  );
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

function userInputText(content: readonly AppServerUserInput[]): string {
  const textItems = content.filter((item) => item.type === "text");
  const hasText = textItems.some((item) => item.text.length > 0);
  const textIncludes = (value: string) => value.length > 0 && textItems.some((item) => item.text.includes(value));
  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      if (item.type === "localImage") return hasText && textIncludes(item.path) ? "" : `[local image] ${item.path}`;
      if (item.type === "image") return hasText && textIncludes(item.url) ? "" : `[image] ${item.url}`;
      if (item.type === "mention") return hasText ? "" : `[@${item.name}] ${item.path}`;
      return hasText ? "" : `[$${item.name}] ${item.path}`;
    })
    .filter(Boolean)
    .join("\n");
}
