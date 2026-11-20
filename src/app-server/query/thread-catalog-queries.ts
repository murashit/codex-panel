import {
  CancelledError,
  InfiniteQueryObserver,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
} from "@tanstack/query-core";
import { applyThreadCatalogChange, type ThreadCatalogChange, threadCatalogChangeList } from "../../domain/threads/catalog";
import type { ThreadFact, ThreadFactSink } from "../../domain/threads/facts";
import type { Thread } from "../../domain/threads/model";
import type { ObservedPaginatedResult, ObservedPaginatedResultListener, ObservedResultListener } from "../../shared/async/observed-result";
import { listPinnedThreads, listThreads, readThreadPage, type ThreadPage } from "../services/threads";
import {
  type ActiveThreadCursor,
  type ActiveThreadData,
  activeThreadDataHasMore,
  activeThreadsFromData,
  applyActiveThreadMutation,
  recentActiveThreadsFromData,
} from "./active-thread-inventory";
import type { AppServerQueryOptions, AppServerQueryScope } from "./query-scope";
import { projectThreadFacts } from "./thread-projection";

const ACTIVE_THREADS_QUERY_KEY = ["threads", "active"] as const;
const ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY = ["threads", "active-search-inventory"] as const;
const ARCHIVED_THREADS_QUERY_KEY = ["threads", "archived"] as const;

type ActiveThreadsQueryKey = typeof ACTIVE_THREADS_QUERY_KEY;

interface PendingReplacement {
  readonly sourceThreadId: string;
  initialReplacement: Thread | null;
  readonly facts: ThreadFact[];
  finished: boolean;
}

export class ThreadCatalog {
  private readonly pendingByThreadId = new Map<string, PendingReplacement>();
  private activeThreadsRefreshRequested = false;

  readonly facts: ThreadFactSink = {
    apply: (fact) => {
      this.acceptFacts([fact]);
    },
    applyBatch: (facts) => {
      this.acceptFacts(facts);
    },
  };

  constructor(
    private readonly scope: AppServerQueryScope,
    private readonly onPublishedFacts: (facts: readonly ThreadFact[]) => void = () => undefined,
  ) {}

  private acceptFacts(facts: readonly ThreadFact[]): void {
    const immediate: ThreadFact[] = [];
    for (const fact of facts) {
      const pending = this.pendingByThreadId.get(threadIdForFact(fact));
      if (!pending || pending.finished) immediate.push(fact);
      else pending.facts.push(fact);
    }
    this.publishFacts(immediate);
  }

  private publishFacts(facts: readonly ThreadFact[]): void {
    if (this.scope.isDisposed() || facts.length === 0) return;
    this.applyThreadCatalogChanges(projectThreadFacts(this, facts));
    this.onPublishedFacts(facts);
  }

  visibleThreadId(visibleThreads: readonly Thread[], threadId: string | null): string | null {
    if (!threadId) return null;
    const pending = this.pendingByThreadId.get(threadId);
    if (!pending || pending.initialReplacement?.id !== threadId) return threadId;
    const replacementVisible = visibleThreads.some((thread) => thread.id === threadId);
    const sourceVisible = visibleThreads.some((thread) => thread.id === pending.sourceThreadId);
    return !replacementVisible && sourceVisible ? pending.sourceThreadId : threadId;
  }

  beginReplacement(sourceThreadId: string) {
    this.scope.assertUsable();
    if (this.pendingByThreadId.has(sourceThreadId)) throw new Error("A replacement publication is already in progress for this thread.");
    const pending: PendingReplacement = { sourceThreadId, initialReplacement: null, facts: [], finished: false };
    this.pendingByThreadId.set(sourceThreadId, pending);
    if (this.scope.client.getQueryState(ACTIVE_THREADS_QUERY_KEY)?.fetchStatus === "fetching") this.activeThreadsRefreshRequested = true;
    void this.scope.client.cancelQueries({ queryKey: ACTIVE_THREADS_QUERY_KEY, exact: true });
    return {
      attach: (replacementThread: Thread) => {
        if (pending.finished) throw new Error("The replacement publication has already finished.");
        if (pending.initialReplacement) throw new Error("A replacement thread is already attached.");
        if (this.pendingByThreadId.has(replacementThread.id))
          throw new Error("A replacement publication is already in progress for this thread.");
        pending.initialReplacement = replacementThread;
        this.pendingByThreadId.set(replacementThread.id, pending);
      },
      finish: (sourceArchived: boolean) => {
        if (pending.finished) return;
        pending.finished = true;
        const completedFacts: ThreadFact[] = pending.initialReplacement
          ? [{ type: "thread-upserted", thread: pending.initialReplacement }, ...pending.facts]
          : [...pending.facts];
        if (sourceArchived && !pending.facts.some((fact) => factRemovesThread(fact, sourceThreadId))) {
          completedFacts.push({ type: "thread-archived", threadId: sourceThreadId });
        }
        try {
          this.publishFacts(completedFacts);
        } finally {
          this.pendingByThreadId.delete(sourceThreadId);
          if (pending.initialReplacement) this.pendingByThreadId.delete(pending.initialReplacement.id);
          if (this.pendingByThreadId.size === 0 && this.activeThreadsRefreshRequested && !this.scope.isDisposed()) {
            this.activeThreadsRefreshRequested = false;
            void this.refreshActiveThreads().catch(() => {
              // Observers retain the last visible snapshot when the deferred refresh fails.
            });
          }
        }
      },
    };
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    if (this.scope.isDisposed()) return null;
    const data = this.scope.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY);
    return data ? activeThreadsFromData(data) : null;
  }

  recentActiveThreadsSnapshot(): readonly Thread[] | null {
    if (this.scope.isDisposed()) return null;
    const data = this.scope.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY);
    return recentActiveThreadsFromData(data);
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    if (this.scope.isDisposed()) return null;
    const threads = this.scope.client.getQueryData<readonly Thread[]>(ARCHIVED_THREADS_QUERY_KEY);
    return threads ?? null;
  }

  observeActiveThreadsResult(listener: ObservedPaginatedResultListener<readonly Thread[]>): () => void {
    const observation = this.watchActiveThreads((read) => {
      listener(read());
    });
    listener(observation.read());
    return observation.close;
  }

  watchActiveThreads(changed: (read: () => ObservedPaginatedResult<readonly Thread[]>) => void) {
    this.scope.assertUsable();
    const observer = new InfiniteQueryObserver<ThreadPage, Error, readonly Thread[], ActiveThreadsQueryKey, ActiveThreadCursor>(
      this.scope.client,
      {
        ...this.activeThreadsQueryOptions(),
        select: activeThreadsFromData,
        enabled: false,
      },
    );
    const read = () => this.projectObservedActiveThreadsResult(observer.getCurrentResult());
    observer.subscribe(() => {
      if (!this.scope.isDisposed()) changed(read);
    });
    return {
      read,
      close: this.scope.trackObserver(() => {
        observer.destroy();
      }),
    };
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>): () => void {
    this.scope.assertUsable();
    return this.scope.observeResult(this.archivedThreadsQueryOptions(), (threads) => threads, listener);
  }

  async fetchActiveThreads(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const frozenSnapshot = this.activeThreadsFrozenSnapshot();
    if (frozenSnapshot) return frozenSnapshot;
    try {
      const data = await this.scope.client.infiniteQuery(this.activeThreadsQueryOptions());
      return activeThreadsFromData(data);
    } catch (error) {
      if (error instanceof CancelledError) {
        this.scope.assertUsable();
        return this.activeThreadsSnapshot() ?? [];
      }
      throw error;
    }
  }

  async refreshActiveThreads(): Promise<void> {
    this.scope.assertUsable();
    if (this.activeThreadsFrozenSnapshot()) return;
    const key = ACTIVE_THREADS_QUERY_KEY;
    if (this.scope.client.getQueryState(key)?.fetchMeta?.fetchMore?.direction === "forward") {
      await this.scope.client.cancelQueries({ queryKey: key, exact: true });
    }
    await this.scope.client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    this.scope.assertUsable();
    await this.fetchActiveThreads();
  }

  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const key = ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY;
    const options = {
      queryKey: key,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.scope.runWithClient((client) => listThreads(client, this.scope.context.vaultPath, { signal })),
      staleTime: 0,
      gcTime: 0,
    };
    return this.scope.client.query(options);
  }

  hasMoreActiveThreads(): boolean {
    if (this.scope.isDisposed()) return false;
    return activeThreadDataHasMore(this.scope.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY));
  }

  async loadMoreActiveThreads(): Promise<void> {
    this.scope.assertUsable();
    const frozenSnapshot = this.activeThreadsFrozenSnapshot();
    if (frozenSnapshot) return;
    const key = ACTIVE_THREADS_QUERY_KEY;
    if (!this.activeThreadsSnapshot() || this.scope.client.getQueryState(key)?.isInvalidated === true) {
      await this.fetchActiveThreads();
    }
    if (this.activeThreadsFrozenSnapshot() || this.scope.client.getQueryState(key)?.isInvalidated === true) return;
    const observer = new InfiniteQueryObserver(this.scope.client, {
      ...this.activeThreadsQueryOptions(),
      enabled: false,
    });
    try {
      if (!observer.getCurrentResult().hasNextPage) return;
      await observer.fetchNextPage({ cancelRefetch: false, throwOnError: true });
    } catch (error) {
      if (error instanceof CancelledError) return;
      throw error;
    } finally {
      observer.destroy();
    }
  }

  async refreshArchivedThreads(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const key = ARCHIVED_THREADS_QUERY_KEY;
    await this.scope.client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    this.scope.assertUsable();
    try {
      return await this.scope.client.query(this.archivedThreadsQueryOptions());
    } catch (error) {
      if (error instanceof CancelledError) {
        this.scope.assertUsable();
        return this.archivedThreadsSnapshot() ?? [];
      }
      throw error;
    }
  }

  applyThreadCatalogChanges(changes: readonly ThreadCatalogChange[]): void {
    this.scope.assertUsable();
    if (changes.length === 0) return;
    const activeChanges = changes.filter((change) => threadCatalogChangeList(change) === "active");
    if (activeChanges.length > 0) {
      const key = ACTIVE_THREADS_QUERY_KEY;
      const before = this.scope.client.getQueryData<ActiveThreadData>(key);
      const after = activeChanges.reduce<ActiveThreadData | undefined>(applyActiveThreadMutation, before);
      this.publishThreadProjection(key, activeChanges, before, after, {
        invalidate: activeChanges.some(activeThreadChangeInvalidatesPages),
        refresh: () => this.refreshActiveThreads(),
      });
    }

    const archivedChanges = changes.filter((change) => threadCatalogChangeList(change) === "archived");
    if (archivedChanges.length > 0) {
      const key = ARCHIVED_THREADS_QUERY_KEY;
      const before = this.scope.client.getQueryData<readonly Thread[]>(key);
      const after = archivedChanges.reduce<readonly Thread[] | null>(applyThreadCatalogChange, before ?? null) ?? undefined;
      this.publishThreadProjection(key, archivedChanges, before, after, {
        invalidate: false,
        refresh: () => this.refreshArchivedThreads(),
      });
    }
  }

  private publishThreadProjection<T>(
    key: readonly unknown[],
    changes: readonly ThreadCatalogChange[],
    before: T | undefined,
    after: T | undefined,
    options: { invalidate: boolean; refresh: () => Promise<unknown> },
  ): void {
    const fetchIsRunning = this.scope.client.getQueryState(key)?.fetchStatus === "fetching";
    const refreshRequired =
      fetchIsRunning ||
      changes.some((change) => change.kind === "revalidate") ||
      (before === undefined && changes.some((change) => change.kind === "upsert"));
    if (fetchIsRunning) void this.scope.client.cancelQueries({ queryKey: key, exact: true });
    if (after !== before)
      this.scope.client.getQueryCache().find<unknown, Error, T>({ queryKey: key, exact: true })?.setState({ data: after });
    if (options.invalidate) void this.scope.client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    if (refreshRequired) {
      void options.refresh().catch(() => {
        // Query observers retain refresh failures while exact facts remain last-known-good state.
      });
    }
  }

  private activeThreadsFrozenSnapshot(): readonly Thread[] | undefined {
    if (this.pendingByThreadId.size === 0) return undefined;
    this.activeThreadsRefreshRequested = true;
    return this.activeThreadsSnapshot() ?? [];
  }

  private activeThreadsQueryOptions(): InfiniteQueryObserverOptions<
    ThreadPage,
    Error,
    ActiveThreadData,
    ActiveThreadsQueryKey,
    ActiveThreadCursor
  > {
    return {
      queryKey: ACTIVE_THREADS_QUERY_KEY,
      queryFn: async ({ pageParam, signal }) => {
        signal.throwIfAborted();
        const page = await this.scope.runWithClient(async (client) => {
          if (pageParam !== null) {
            return readThreadPage(client, this.scope.context.vaultPath, {
              cursor: pageParam,
              archived: false,
            });
          }
          const [pinnedThreads, firstPage] = await Promise.all([
            listPinnedThreads(client, this.scope.context.vaultPath, { archived: false, signal }),
            readThreadPage(client, this.scope.context.vaultPath, { archived: false }),
          ]);
          const threads = [...pinnedThreads, ...firstPage.threads];
          return {
            ...firstPage,
            threads,
            fetchedSize: new Set(threads.map((thread) => thread.id)).size,
          };
        });
        signal.throwIfAborted();
        return page;
      },
      initialPageParam: null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    };
  }

  private archivedThreadsQueryOptions(): AppServerQueryOptions<readonly Thread[]> {
    return {
      queryKey: ARCHIVED_THREADS_QUERY_KEY,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.scope.runWithClient((client) => listThreads(client, this.scope.context.vaultPath, { archived: true, signal })),
    };
  }

  private projectObservedActiveThreadsResult(
    result: InfiniteQueryObserverResult<readonly Thread[]>,
  ): ObservedPaginatedResult<readonly Thread[]> {
    return {
      value: result.data ?? null,
      error: result.error instanceof Error ? result.error : null,
      isFetching: result.isFetching,
      hasMore: result.hasNextPage,
      isFetchingNextPage: result.isFetchingNextPage,
    };
  }
}

function activeThreadChangeInvalidatesPages(change: ThreadCatalogChange): boolean {
  return change.kind !== "update" || Object.hasOwn(change.changes, "isPinned") || Object.hasOwn(change.changes, "recencyAt");
}

function factRemovesThread(fact: ThreadFact, threadId: string): boolean {
  return (fact.type === "thread-archived" || fact.type === "thread-deleted") && fact.threadId === threadId;
}

function threadIdForFact(fact: ThreadFact): string {
  return fact.type === "thread-upserted" ? fact.thread.id : fact.threadId;
}
