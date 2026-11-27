import type { InfiniteData } from "@tanstack/query-core";
import { applyThreadCatalogChange, type ThreadCatalogChange, threadCatalogChangeList } from "../../domain/threads/catalog";
import { compareThreadsPinnedFirst, isThreadVisibleInCatalog, type Thread } from "../../domain/threads/model";
import type { ThreadPage } from "../services/threads";

export type ActiveThreadCursor = string | null;
export type ActiveThreadData = InfiniteData<ThreadPage, ActiveThreadCursor>;

export function activeThreadsFromData(data: ActiveThreadData): readonly Thread[] {
  return orderedUniqueThreads(data.pages.flatMap((page) => page.threads));
}

export function recentActiveThreadsFromData(data: ActiveThreadData | undefined): readonly Thread[] | null {
  if (!data) return null;
  const threads = activeThreadsFromData(data);
  const recentWindowCapacity = Math.max(data.pages[0]?.fetchedSize ?? 0, threads.length > 0 ? 1 : 0);
  return threads.slice(0, recentWindowCapacity);
}

export function activeThreadDataHasMore(data: ActiveThreadData | undefined): boolean {
  return data?.pages.at(-1)?.nextCursor != null;
}

export function applyActiveThreadMutation(data: ActiveThreadData | undefined, change: ThreadCatalogChange): ActiveThreadData | undefined {
  if (!data || threadCatalogChangeList(change) !== "active" || change.kind === "revalidate") return data;
  let upsertPages: ThreadPage[] | undefined;
  if (change.kind === "upsert") {
    upsertPages = data.pages.filter((page) => page.threads.some((thread) => thread.id === change.thread.id));
    if (upsertPages.length === 0) upsertPages = data.pages.slice(0, 1);
  }

  const pages = data.pages.map((page) => {
    if (upsertPages && !upsertPages.includes(page)) return page;
    const threads = applyThreadCatalogChange(page.threads, change);
    return threads && threads !== page.threads ? { ...page, threads } : page;
  });
  return pages.some((page, index) => page !== data.pages[index]) ? { ...data, pages } : data;
}

function orderedUniqueThreads(threads: readonly Thread[]): readonly Thread[] {
  const seen = new Set<string>();
  return threads
    .filter((thread) => {
      if (!isThreadVisibleInCatalog(thread) || seen.has(thread.id)) return false;
      seen.add(thread.id);
      return true;
    })
    .sort(compareThreadsPinnedFirst);
}
