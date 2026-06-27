import type { Thread } from "../../domain/threads/model";

export interface ThreadRecord {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number | null;
  [key: string]: unknown;
}

export function threadFromThreadRecord(thread: ThreadRecord, options: { archived?: boolean } = {}): Thread {
  const hasRecencyAt = Object.hasOwn(thread, "recencyAt");
  const recencyAt = hasRecencyAt ? thread.recencyAt : undefined;
  return {
    id: thread.id,
    preview: normalizeString(thread.preview),
    name: thread.name === null ? null : normalizeString(thread.name),
    archived: options.archived ?? false,
    createdAt: finiteTimestamp(thread.createdAt),
    updatedAt: finiteTimestamp(thread.updatedAt),
    ...(hasRecencyAt ? { recencyAt: typeof recencyAt === "number" && Number.isFinite(recencyAt) ? recencyAt : null } : {}),
  };
}

export function threadsFromThreadRecords(threads: readonly ThreadRecord[], options: { archived?: boolean } = {}): Thread[] {
  return threads.map((thread) => threadFromThreadRecord(thread, options));
}

function normalizeString(value: string): string {
  return typeof value === "string" ? value : "";
}

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
