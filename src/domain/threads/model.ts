import type { Thread } from "../../generated/app-server/v2/Thread";
import { shortThreadId } from "../../utils";

const MAX_THREAD_DISPLAY_TITLE_LENGTH = 96;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getThreadTitle(thread: Thread): string {
  return (
    [thread.name, thread.preview, thread.id].map((value) => (typeof value === "string" ? normalizeTitle(value) : "")).find(Boolean) ??
    thread.id
  );
}

export function explicitThreadName(thread: Thread): string | null {
  const name = typeof thread.name === "string" ? normalizeTitle(thread.name) : "";
  return name.length > 0 ? name : null;
}

export function codexPanelDisplayTitle(activeThreadId: string | null, threads: readonly Thread[], fallbackTitle?: string | null): string {
  if (!activeThreadId) return "Codex";

  const thread = threads.find((item) => item.id === activeThreadId);
  const title = thread ? fullThreadTitle(thread) : (fallbackTitle ?? shortThreadId(activeThreadId));
  return title ? `Codex: ${title}` : "Codex";
}

export function inheritedForkThreadName(threadId: string, threads: readonly Thread[]): string | null {
  const thread = threads.find((item) => item.id === threadId);
  return thread ? explicitThreadName(thread) : null;
}

export function upsertThread(threads: readonly Thread[], thread: Thread): Thread[] {
  const index = threads.findIndex((item) => item.id === thread.id);
  if (index === -1) return [thread, ...threads];
  return threads.map((item, itemIndex) => (itemIndex === index ? { ...item, ...thread } : item));
}

export function archivedThreadDisplayTitle(thread: Thread): string {
  const title = fullThreadTitle(thread);
  if (!title || title === thread.id || UUID_PATTERN.test(title)) return "Untitled archived thread";
  return truncateTitle(title, MAX_THREAD_DISPLAY_TITLE_LENGTH);
}

function fullThreadTitle(thread: Thread): string {
  return normalizeTitle(getThreadTitle(thread));
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
