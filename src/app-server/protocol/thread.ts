import type { Thread } from "../../domain/threads/model";

export interface ThreadRecord {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export function threadFromThreadRecord(thread: ThreadRecord, options: { archived?: boolean } = {}): Thread {
  return {
    id: thread.id,
    preview: normalizeString(thread.preview),
    name: normalizeNullableString(thread.name),
    archived: options.archived ?? false,
    createdAt: finiteTimestamp(thread.createdAt),
    updatedAt: finiteTimestamp(thread.updatedAt),
  };
}

export function threadsFromThreadRecords(threads: readonly ThreadRecord[], options: { archived?: boolean } = {}): Thread[] {
  return threads.map((thread) => threadFromThreadRecord(thread, options));
}

function normalizeNullableString(value: string | null): string | null {
  return value === null ? null : normalizeString(value);
}

function normalizeString(value: string): string {
  return typeof value === "string" ? value : "";
}

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
