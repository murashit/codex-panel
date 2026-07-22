import type { InfiniteData } from "@tanstack/query-core";
import type { ThreadCatalogChange } from "../../domain/threads/catalog-read-model";
import { type Thread, threadRecencyAt } from "../../domain/threads/model";
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
      const existing = pages.some((page) => page.threads.some((thread) => thread.id === change.thread.id));
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
      for (const page of pages) page.threads = page.threads.filter((thread) => thread.id !== change.threadId);
      break;
    case "update":
      for (const page of pages) {
        page.threads = page.threads.map((thread) => (thread.id === change.threadId ? { ...thread, ...change.changes } : thread));
      }
      break;
  }

  return { pages, pageParams: [...data.pageParams] };
}

function orderedUniqueThreads(threads: readonly Thread[]): readonly Thread[] {
  const seen = new Set<string>();
  return threads
    .filter((thread) => {
      if (seen.has(thread.id)) return false;
      seen.add(thread.id);
      return true;
    })
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) => threadRecencyAt(right.thread) - threadRecencyAt(left.thread) || left.index - right.index)
    .map(({ thread }) => thread);
}
