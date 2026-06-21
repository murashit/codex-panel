export interface Thread {
  readonly id: string;
  readonly preview: string;
  readonly name: string | null;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
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
