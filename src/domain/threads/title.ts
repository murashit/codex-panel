import { shortThreadId } from "./id";
import { normalizeExplicitThreadName, type Thread } from "./model";

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
