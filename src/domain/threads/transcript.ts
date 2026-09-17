import type { Thread } from "./model";

export const REFERENCED_THREAD_TURN_LIMIT = 20;

export interface ReferencedThreadMetadata {
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
  omittedTurns?: number;
  truncated?: boolean;
}

interface ReferencedThreadMessage {
  kind: "user" | "assistant" | "plan";
  text: string;
}

export interface ReferencedThreadTurn {
  messages: readonly ReferencedThreadMessage[];
}

export interface ReferencedThreadTranscriptPage {
  turns: readonly ReferencedThreadTurn[];
  earlierTurnsAvailable: boolean;
}

export interface ThreadTranscript extends Thread {
  transcriptEntries: readonly ThreadTranscriptEntry[];
}

type ThreadTranscriptEntryKind = "user" | "assistant" | "plan";

export interface ThreadTranscriptEntry {
  kind: ThreadTranscriptEntryKind;
  text: string;
  timestamp: number | null;
  referencedThread?: ReferencedThreadMetadata;
  contexts?: readonly ThreadTranscriptContext[];
}

interface ThreadTranscriptContext {
  kind: "web" | "obsidian";
  truncated: boolean;
}

export interface TurnTranscriptSummary {
  userText: string | null;
  assistantText: string | null;
}

export function turnTranscriptSummaryFromTranscriptEntries(entries: readonly ThreadTranscriptEntry[]): TurnTranscriptSummary {
  const userText = entries.find((entry) => entry.kind === "user" && entry.text.trim())?.text.trim() ?? null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || (entry.kind !== "assistant" && entry.kind !== "plan")) continue;
    const assistantText = entry.text.trim();
    if (assistantText) return { userText, assistantText };
  }
  return { userText, assistantText: null };
}

export function nonEmptyTurnTranscriptSummaries(summaries: readonly TurnTranscriptSummary[]): TurnTranscriptSummary[] {
  return summaries.filter((summary) => summary.userText !== null || summary.assistantText !== null);
}
