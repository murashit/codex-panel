export interface Thread {
  id: string;
  preview: string;
  name: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export function getThreadTitle(thread: Thread): string {
  return (
    [thread.name, thread.preview, thread.id].map((value) => (typeof value === "string" ? normalizeTitle(value) : "")).find(Boolean) ??
    thread.id
  );
}

export function explicitThreadName(thread: Thread): string | null {
  return normalizeExplicitThreadName(thread.name);
}

export function normalizeExplicitThreadName(value: string | null | undefined): string | null {
  const name = typeof value === "string" ? normalizeTitle(value) : "";
  return name.length > 0 ? name : null;
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

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
