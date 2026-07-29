import type { InfiniteData } from "@tanstack/query-core";
import { type ThreadCatalogChange, threadCatalogEntryEqual } from "../../domain/threads/catalog-read-model";
import { compareThreadsPinnedFirst, isThreadVisibleInCatalog, type Thread } from "../../domain/threads/model";
import type { ThreadPage } from "../services/threads";

export type ActiveThreadCursor = string | null;
export type ActiveThreadData = InfiniteData<ThreadPage, ActiveThreadCursor>;

export function activeThreadsFromData(data: ActiveThreadData | undefined): readonly Thread[] | null {
  if (!data) return null;
  return orderedUniqueThreads(data.pages.flatMap((page) => page.threads));
}

export function recentActiveThreadsFromData(data: ActiveThreadData | undefined): readonly Thread[] | null {
  if (!data) return null;
  const threads = activeThreadsFromData(data) ?? [];
  const recentWindowCapacity = Math.max(data.pages[0]?.fetchedSize ?? 0, threads.length > 0 ? 1 : 0);
  return threads.slice(0, recentWindowCapacity);
}

export function activeThreadDataHasMore(data: ActiveThreadData | undefined): boolean {
  return data?.pages.at(-1)?.nextCursor != null;
}

export function applyActiveThreadMutation(data: ActiveThreadData | undefined, change: ThreadCatalogChange): ActiveThreadData | undefined {
  if (!data || change.list !== "active" || change.kind === "revalidate") return data;
  const pages = data.pages.map((page) => ({ ...page, threads: [...page.threads] }));

  switch (change.kind) {
    case "upsert": {
      const current = pages.flatMap((page) => page.threads).find((thread) => thread.id === change.thread.id);
      if (threadCatalogEntryEqual(current, change.thread)) return data;
      const existing = current !== undefined;
      if (existing) {
        for (const page of pages) {
          page.threads = page.threads.map((thread) => (thread.id === change.thread.id ? change.thread : thread));
        }
      } else if (pages[0]) {
        pages[0].threads = [change.thread, ...pages[0].threads];
      }
      break;
    }
    case "remove":
      if (!pages.some((page) => page.threads.some((thread) => thread.id === change.threadId))) return data;
      for (const page of pages) page.threads = page.threads.filter((thread) => thread.id !== change.threadId);
      break;
    case "update":
      if (!pages.some((page) => page.threads.some((thread) => threadCatalogUpdateChangesEntry(thread, change)))) return data;
      for (const page of pages) {
        page.threads = page.threads.map((thread) => (thread.id === change.threadId ? { ...thread, ...change.changes } : thread));
      }
      break;
  }

  return { pages, pageParams: [...data.pageParams] };
}

function threadCatalogUpdateChangesEntry(thread: Thread, change: Extract<ThreadCatalogChange, { kind: "update" }>): boolean {
  if (thread.id !== change.threadId) return false;
  return (
    (Object.hasOwn(change.changes, "name") && thread.name !== change.changes.name) ||
    (Object.hasOwn(change.changes, "isPinned") && (thread.isPinned === true) !== (change.changes.isPinned === true)) ||
    (Object.hasOwn(change.changes, "recencyAt") && thread.recencyAt !== change.changes.recencyAt)
  );
}

function orderedUniqueThreads(threads: readonly Thread[]): readonly Thread[] {
  const seen = new Set<string>();
  return threads
    .filter((thread) => isThreadVisibleInCatalog(thread))
    .filter((thread) => {
      if (seen.has(thread.id)) return false;
      seen.add(thread.id);
      return true;
    })
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) => compareThreadsPinnedFirst(left.thread, right.thread) || left.index - right.index)
    .map(({ thread }) => thread);
}
