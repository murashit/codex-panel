import type { Thread as AppServerThread } from "../generated/app-server/v2/Thread";
import type { Thread } from "../domain/threads/model";

export type { AppServerThread };

export function threadFromAppServerThread(thread: AppServerThread, options: { archived?: boolean } = {}): Thread {
  return {
    id: thread.id,
    preview: normalizeString(thread.preview),
    name: normalizeNullableString(thread.name),
    archived: options.archived ?? false,
    createdAt: finiteTimestamp(thread.createdAt),
    updatedAt: finiteTimestamp(thread.updatedAt),
  };
}

export function threadsFromAppServerThreads(threads: readonly AppServerThread[], options: { archived?: boolean } = {}): Thread[] {
  return threads.map((thread) => threadFromAppServerThread(thread, options));
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
