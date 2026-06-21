import { shortThreadId } from "../../utils";
import { getThreadTitle, type Thread } from "./model";

const MAX_ARCHIVED_THREAD_DISPLAY_TITLE_LENGTH = 96;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function threadUserTitle(thread: Thread): string {
  return usefulThreadTitle(thread) ?? getThreadTitle(thread);
}

export function threadRenameDraftTitle(thread: Thread): string {
  return usefulThreadTitle(thread) ?? "";
}

export function threadArchiveDisplayTitle(thread: Thread): string {
  const title = usefulThreadTitle(thread);
  return title ? truncateThreadTitle(title, MAX_ARCHIVED_THREAD_DISPLAY_TITLE_LENGTH) : "Untitled archived thread";
}

export function threadWindowTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? threadUserTitle(thread) : normalizeTitle(fallbackTitle) || shortThreadId(activeThreadId);
  return title ? `Codex: ${title}` : "Codex";
}

function usefulThreadTitle(thread: Thread): string | null {
  for (const value of [thread.name, thread.preview]) {
    const title = normalizeTitle(value);
    if (title && title !== thread.id && !UUID_PATTERN.test(title)) return title;
  }
  return null;
}

function normalizeTitle(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateThreadTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
