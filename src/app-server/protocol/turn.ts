import type { ReferencedThreadTurn } from "../../domain/threads/transcript";
import {
  type ThreadTranscriptEntry,
  type TurnTranscriptSummary,
  turnTranscriptSummaryFromTranscriptEntries,
} from "../../domain/threads/transcript";
import type { ThreadItem as GeneratedThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn as GeneratedTurn } from "../../generated/app-server/v2/Turn";

export type TurnItem = GeneratedThreadItem;
export type TurnRecord = GeneratedTurn;

function transcriptEntriesFromTurnRecord(turn: TurnRecord): ThreadTranscriptEntry[] {
  return turn.items.flatMap((item) => transcriptEntriesFromTurnItem(item, turn));
}

export function transcriptEntriesFromTurnRecords(turns: readonly TurnRecord[]): ThreadTranscriptEntry[] {
  return turns.flatMap(transcriptEntriesFromTurnRecord);
}

export function referencedThreadTurnsFromNewestFirstTurnRecords(turns: readonly TurnRecord[]): ReferencedThreadTurn[] {
  return [...turns].reverse().flatMap((turn) => {
    const messages = transcriptEntriesFromTurnRecord(turn).map(({ kind, text }) => ({ kind, text }));
    return messages.length > 0 ? [{ messages }] : [];
  });
}

function turnTranscriptSummaryFromTurnRecord(turn: TurnRecord): TurnTranscriptSummary {
  return turnTranscriptSummaryFromTranscriptEntries(transcriptEntriesFromTurnRecord(turn));
}

export function completedTurnTranscriptSummaryFromTurnRecord(turn: TurnRecord): TurnTranscriptSummary | null {
  if (turn.status !== "completed") return null;
  const summary = turnTranscriptSummaryFromTurnRecord(turn);
  return summary.userText && summary.assistantText ? summary : null;
}

export function completedTurnTranscriptSummariesFromTurnRecords(turns: readonly TurnRecord[]): TurnTranscriptSummary[] {
  return turns.flatMap((turn) => {
    const summary = completedTurnTranscriptSummaryFromTurnRecord(turn);
    return summary ? [summary] : [];
  });
}

export function turnUserItemText(item: Extract<TurnItem, { type: "userMessage" }>): string {
  const visibleText = item.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join("\n");
  return [visibleText, nonTextUserInputText(item.content, visibleText)].filter(Boolean).join("\n");
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
  if (item.type === "agentMessage" || item.type === "plan") {
    const text = item.text.trim();
    const kind = item.type === "agentMessage" ? "assistant" : "plan";
    return text ? [{ kind, text, timestamp: turn.completedAt ?? turn.startedAt }] : [];
  }
  return [];
}

function nonTextUserInputText(content: Extract<TurnItem, { type: "userMessage" }>["content"], visibleText: string): string {
  const hasText = visibleText.length > 0;
  const textIncludes = (value: string) => value.length > 0 && visibleText.includes(value);
  return content
    .map((item) => {
      if (item.type === "localImage") return hasText && textIncludes(item.path) ? "" : `[local image] ${item.path}`;
      if (item.type === "image") {
        if ("fileId" in item) return "[image]";
        return hasText && textIncludes(item.url) ? "" : `[image] ${item.url}`;
      }
      if (item.type === "mention") return hasText ? "" : `[@${item.name}] ${item.path}`;
      if (item.type === "skill") return hasText ? "" : `[$${item.name}] ${item.path}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
