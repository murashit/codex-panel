import type { Turn } from "../generated/app-server/v2/Turn";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { UserInput } from "../generated/app-server/v2/UserInput";
import {
  conversationSummaryFromTranscriptEntries,
  nonEmptyConversationSummaries,
  type ThreadConversationSummary,
  type ThreadTranscriptEntry,
} from "../domain/threads/transcript";

export function transcriptEntriesFromAppServerTurn(turn: Turn): ThreadTranscriptEntry[] {
  return turn.items.flatMap((item) => transcriptEntriesFromAppServerThreadItem(item, turn));
}

export function conversationSummaryFromAppServerTurn(turn: Turn): ThreadConversationSummary {
  return conversationSummaryFromTranscriptEntries(transcriptEntriesFromAppServerTurn(turn));
}

export function completedConversationSummaryFromAppServerTurn(turn: Turn): ThreadConversationSummary | null {
  if (turn.status !== "completed") return null;
  const summary = conversationSummaryFromAppServerTurn(turn);
  return summary.userText && summary.assistantText ? summary : null;
}

export function chronologicalConversationSummariesFromAppServerTurns(turns: readonly Turn[]): ThreadConversationSummary[] {
  return nonEmptyConversationSummaries(chronologicalAppServerTurns(turns).map(conversationSummaryFromAppServerTurn));
}

export function appServerUserItemText(item: Extract<ThreadItem, { type: "userMessage" }>): string {
  return appServerUserInputText(item.content);
}

export function lastAgentMessageTextFromAppServerTurn(turn: Turn): string | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item === undefined) continue;
    if (item.type !== "agentMessage") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}

function transcriptEntriesFromAppServerThreadItem(item: ThreadItem, turn: Turn): ThreadTranscriptEntry[] {
  if (item.type === "userMessage") {
    const text = appServerUserItemText(item).trim();
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

function appServerUserInputText(content: UserInput[]): string {
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

function chronologicalAppServerTurns(turns: readonly Turn[]): Turn[] {
  return [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}
