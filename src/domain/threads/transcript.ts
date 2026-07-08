type ThreadTranscriptEntryKind = "user" | "assistant" | "plan";

export interface ThreadTranscriptEntry {
  kind: ThreadTranscriptEntryKind;
  text: string;
  timestamp: number | null;
}

export interface TurnTranscriptSummary {
  userText: string | null;
  assistantText: string | null;
}

export function turnTranscriptSummaryFromTranscriptEntries(entries: readonly ThreadTranscriptEntry[]): TurnTranscriptSummary {
  return {
    userText: firstTranscriptText(entries, (entry) => entry.kind === "user"),
    assistantText: lastTranscriptText(entries, (entry) => entry.kind === "assistant" || entry.kind === "plan"),
  };
}

export function nonEmptyTurnTranscriptSummaries(summaries: readonly TurnTranscriptSummary[]): TurnTranscriptSummary[] {
  return summaries.filter((summary) => summary.userText !== null || summary.assistantText !== null);
}

function firstTranscriptText(
  entries: readonly ThreadTranscriptEntry[],
  predicate: (entry: ThreadTranscriptEntry) => boolean,
): string | null {
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    const text = entry.text.trim();
    if (text) return text;
  }
  return null;
}

function lastTranscriptText(
  entries: readonly ThreadTranscriptEntry[],
  predicate: (entry: ThreadTranscriptEntry) => boolean,
): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || !predicate(entry)) continue;
    const text = entry.text.trim();
    if (text) return text;
  }
  return null;
}
