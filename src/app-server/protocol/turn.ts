import { fileReferencesFromManifest, referencedThreadFromManifest, userMessageContextProjection } from "../../domain/chat/context-manifest";
import type { VaultFileReference } from "../../domain/chat/input";
import type { ReferencedThreadMetadata } from "../../domain/threads/reference";
import {
  nonEmptyTurnTranscriptSummaries,
  type ThreadTranscriptEntry,
  type TurnTranscriptSummary,
  turnTranscriptSummaryFromTranscriptEntries,
} from "../../domain/threads/transcript";
import type { ThreadItem as GeneratedThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn as GeneratedTurn } from "../../generated/app-server/v2/Turn";
import { legacyPanelUserMessageProjection } from "./legacy-panel-user-message";

export type TurnItem = GeneratedThreadItem;
export type TurnRecord = GeneratedTurn;

function transcriptEntriesFromTurnRecord(turn: TurnRecord): ThreadTranscriptEntry[] {
  return turn.items.flatMap((item) => transcriptEntriesFromTurnItem(item, turn));
}

export function transcriptEntriesFromTurnRecords(turns: readonly TurnRecord[]): ThreadTranscriptEntry[] {
  return turns.flatMap(transcriptEntriesFromTurnRecord);
}

function turnTranscriptSummaryFromTurnRecord(turn: TurnRecord): TurnTranscriptSummary {
  return turnTranscriptSummaryFromTranscriptEntries(transcriptEntriesFromTurnRecord(turn));
}

export function turnTranscriptAssistantTextFromTurnRecord(turn: TurnRecord): string | null {
  return turnTranscriptSummaryFromTurnRecord(turn).assistantText;
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

export function chronologicalTurnTranscriptSummariesFromTurnRecords(turns: readonly TurnRecord[]): TurnTranscriptSummary[] {
  return nonEmptyTurnTranscriptSummaries(
    [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)).map(turnTranscriptSummaryFromTurnRecord),
  );
}

export interface TurnUserItemProjection {
  text: string;
  referencedThread: ReferencedThreadMetadata | null;
  fileReferences: VaultFileReference[];
  manifest: ReturnType<typeof userMessageContextProjection>["manifest"];
}

export function turnUserItemProjection(item: Extract<TurnItem, { type: "userMessage" }>): TurnUserItemProjection {
  const projected = userMessageContextProjection(item.content, item.clientId);
  if (!projected.manifest) {
    const legacy = legacyPanelUserMessageProjection({
      content: item.content,
      visibleText: projected.text,
    });
    const supplementalText = nonTextUserInputText(item.content, projected.text, legacy.mentionTextByContentIndex);
    return {
      text: [legacy.text, supplementalText].filter(Boolean).join("\n"),
      referencedThread: legacy.referencedThread,
      fileReferences: legacy.fileReferences,
      manifest: null,
    };
  }
  const supplementalText = nonTextUserInputText(item.content, projected.text);
  const text = [projected.text, supplementalText].filter(Boolean).join("\n");
  return {
    text,
    referencedThread: referencedThreadFromManifest(projected.manifest),
    fileReferences: fileReferencesFromManifest(projected.manifest),
    manifest: projected.manifest,
  };
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
    const projection = turnUserItemProjection(item);
    const text = projection.text.trim();
    const contexts =
      projection.manifest?.contexts
        .filter((context) => context.kind === "web" || context.kind === "obsidian")
        .map((context) => ({ kind: context.kind as "web" | "obsidian", truncated: context.truncated })) ?? [];
    return text
      ? [
          {
            kind: "user",
            text,
            timestamp: turn.startedAt,
            ...(projection.referencedThread ? { referencedThread: projection.referencedThread } : {}),
            ...(contexts.length > 0 ? { contexts } : {}),
          },
        ]
      : [];
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

function nonTextUserInputText(
  content: Extract<TurnItem, { type: "userMessage" }>["content"],
  visibleText: string,
  mentionTextByContentIndex?: ReadonlyMap<number, string>,
): string {
  const hasText = visibleText.length > 0;
  const textIncludes = (value: string) => value.length > 0 && visibleText.includes(value);
  return content
    .map((item, index) => {
      if (item.type === "localImage") return hasText && textIncludes(item.path) ? "" : `[local image] ${item.path}`;
      if (item.type === "image") return hasText && textIncludes(item.url) ? "" : `[image] ${item.url}`;
      if (item.type === "mention") return mentionTextByContentIndex?.get(index) ?? "";
      if (item.type === "skill") return hasText ? "" : `[$${item.name}] ${item.path}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
