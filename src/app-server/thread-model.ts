import type { Thread } from "../generated/app-server/v2/Thread";
import type { PanelThread } from "../domain/threads/model";

export function panelThreadFromAppServerThread(thread: Thread, options: { archived?: boolean } = {}): PanelThread {
  return {
    id: thread.id,
    preview: normalizeString(thread.preview),
    name: normalizeNullableString(thread.name),
    archived: options.archived ?? false,
    createdAt: finiteTimestamp(thread.createdAt),
    updatedAt: finiteTimestamp(thread.updatedAt),
  };
}

export function panelThreadsFromAppServerThreads(threads: readonly Thread[], options: { archived?: boolean } = {}): PanelThread[] {
  return threads.map((thread) => panelThreadFromAppServerThread(thread, options));
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
