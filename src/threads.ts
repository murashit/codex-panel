import type { Thread } from "./generated/app-server/v2/Thread";
import { shortThreadId } from "./utils";

const MAX_THREAD_DISPLAY_TITLE_LENGTH = 96;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getThreadTitle(thread: Thread): string {
  return thread.name || thread.preview || thread.id;
}

export function codexPanelDisplayTitle(activeThreadId: string | null, threads: Thread[]): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? fullThreadTitle(thread) : shortThreadId(activeThreadId);
  return title ? `Codex: ${title}` : "Codex";
}

export function inheritedForkThreadName(threadId: string, threads: Thread[]): string | null {
  const name = threads.find((thread) => thread.id === threadId)?.name?.trim();
  return name || null;
}

export function archivedThreadDisplayTitle(thread: Thread): string {
  const title = fullThreadTitle(thread);
  if (!title || title === thread.id || UUID_PATTERN.test(title)) return "Untitled archived thread";
  return truncateTitle(title, MAX_THREAD_DISPLAY_TITLE_LENGTH);
}

export function fullThreadTitle(thread: Thread): string {
  return normalizeTitle(getThreadTitle(thread));
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
