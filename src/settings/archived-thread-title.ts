import { getThreadTitle, type Thread } from "../domain/threads/model";

const MAX_ARCHIVED_THREAD_DISPLAY_TITLE_LENGTH = 96;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function archivedThreadDisplayTitle(thread: Thread): string {
  const title = normalizedThreadTitle(thread);
  if (!title || title === thread.id || UUID_PATTERN.test(title)) return "Untitled archived thread";
  return truncateTitle(title, MAX_ARCHIVED_THREAD_DISPLAY_TITLE_LENGTH);
}

function normalizedThreadTitle(thread: Thread): string {
  return getThreadTitle(thread).replace(/\s+/g, " ").trim();
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
