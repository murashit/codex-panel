import { truncate } from "../text/text";
import { normalizeExplicitThreadName, shortThreadId, type Thread } from "./model";
import type { TurnTranscriptSummary } from "./transcript";

const MAX_THREAD_COMMAND_DISPLAY_TITLE_LENGTH = 96;
const UNTITLED_THREAD_TITLE = "Untitled thread";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function threadMeaningfulTitle(thread: Thread): string | null {
  for (const value of [thread.name, thread.preview]) {
    const title = normalizeExplicitThreadName(value);
    if (title && title !== thread.id && !UUID_PATTERN.test(title)) return title;
  }
  return null;
}

export function threadDisplayTitle(thread: Thread): string {
  return threadMeaningfulTitle(thread) ?? UNTITLED_THREAD_TITLE;
}

export function threadCommandDisplayTitle(thread: Thread): string {
  return truncateThreadDisplayTitle(threadDisplayTitle(thread), MAX_THREAD_COMMAND_DISPLAY_TITLE_LENGTH);
}

export function threadRenameDraftTitle(thread: Thread): string {
  return threadMeaningfulTitle(thread) ?? "";
}

export function threadWindowTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const restoredTitle = normalizeExplicitThreadName(fallbackTitle);
  const title = thread ? (threadMeaningfulTitle(thread) ?? shortThreadId(thread.id)) : (restoredTitle ?? shortThreadId(activeThreadId));
  return title ? `Codex: ${title}` : "Codex";
}

function truncateThreadDisplayTitle(title: string, maxLength: number): string {
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(title), ({ segment }) => segment);
  if (graphemes.length <= maxLength) return title;
  return `${graphemes
    .slice(0, maxLength - 3)
    .join("")
    .trimEnd()}...`;
}

const THREAD_TITLE_CONTEXT_MAX_CHARS = 4_000;

export interface ThreadTitleContext {
  userRequest: string;
  assistantResponse: string;
}

export function threadTitleContextFromTurnTranscriptSummary(summary: TurnTranscriptSummary): ThreadTitleContext | null {
  if (!summary.userText || !summary.assistantText) return null;

  return {
    userRequest: threadTitleContextPromptText(summary.userText),
    assistantResponse: threadTitleContextPromptText(summary.assistantText),
  };
}

export function threadTitleContextPromptText(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), THREAD_TITLE_CONTEXT_MAX_CHARS);
}

type ThreadRenameAutoNameState = { kind: "checking" } | { kind: "unavailable" } | { kind: "ready"; context: ThreadTitleContext };

export type ThreadRenameActiveState =
  | { kind: "editing"; draft: string; autoName: ThreadRenameAutoNameState }
  | { kind: "saving"; draft: string; autoName: ThreadRenameAutoNameState }
  | { kind: "generating"; draft: string; autoName: Extract<ThreadRenameAutoNameState, { kind: "ready" }> };
