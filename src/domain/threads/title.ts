import { shortThreadId } from "./id";
import type { Thread } from "./model";

const MAX_ARCHIVED_THREAD_DISPLAY_TITLE_LENGTH = 96;
const MAX_THREAD_COMMAND_DISPLAY_TITLE_LENGTH = 96;
const UNTITLED_THREAD_TITLE = "Untitled thread";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function threadMeaningfulTitle(thread: Thread): string | null {
  for (const value of [thread.name, thread.preview]) {
    const title = normalizeThreadTitleText(value);
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

export function threadArchiveTitle(thread: Thread): string {
  return threadMeaningfulTitle(thread) ?? UNTITLED_THREAD_TITLE;
}

export function threadArchiveDisplayTitle(thread: Thread): string {
  return truncateThreadDisplayTitle(threadArchiveTitle(thread), MAX_ARCHIVED_THREAD_DISPLAY_TITLE_LENGTH);
}

export function threadWindowTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const restoredTitle = normalizeThreadTitleText(fallbackTitle);
  const title = thread
    ? (threadMeaningfulTitle(thread) ?? shortThreadId(thread.id))
    : restoredTitle.length > 0
      ? restoredTitle
      : shortThreadId(activeThreadId);
  return title ? `Codex: ${title}` : "Codex";
}

function normalizeThreadTitleText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateThreadDisplayTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength - 3).trimEnd()}...`;
}
