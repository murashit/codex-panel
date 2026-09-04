import {
  CancelledError,
  InfiniteQueryObserver,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
} from "@tanstack/query-core";
import { applyThreadCatalogChange, type ThreadCatalogChange, type ThreadCatalogList } from "../../domain/threads/catalog-read-model";
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
import { cloneThreads } from "./snapshots";

const ACTIVE_THREADS_QUERY_KEY = ["threads", "active"] as const;
const ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY = ["threads", "active-search-inventory"] as const;
const ARCHIVED_THREADS_QUERY_KEY = ["threads", "archived"] as const;

type ActiveThreadsQueryKey = typeof ACTIVE_THREADS_QUERY_KEY;

export class AppServerThreadCatalog {
  private activeThreadsFreezeCount = 0;
  private activeThreadsRefreshRequested = false;

  constructor(private readonly scope: AppServerQueryScope) {}

  freezeActiveThreads(): () => void {
    this.scope.assertUsable();
    this.activeThreadsFreezeCount += 1;
    if (this.scope.client.getQueryState(ACTIVE_THREADS_QUERY_KEY)?.fetchStatus === "fetching") {
      this.activeThreadsRefreshRequested = true;
    }
    void this.scope.client.cancelQueries({ queryKey: ACTIVE_THREADS_QUERY_KEY, exact: true });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeThreadsFreezeCount -= 1;
      if (this.activeThreadsFreezeCount === 0 && this.activeThreadsRefreshRequested) {
        this.activeThreadsRefreshRequested = false;
        void this.refreshActiveThreads().catch(() => {
          // Observers retain the last visible snapshot when the deferred refresh fails.
        });
      }
    };
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    if (this.scope.isDisposed()) return null;
    const data = this.scope.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY);
    const threads = activeThreadsFromData(data);
    return threads ? cloneThreads(threads) : null;
  }

  recentActiveThreadsSnapshot(): readonly Thread[] | null {
    if (this.scope.isDisposed()) return null;
    const data = this.scope.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY);
    const threads = recentActiveThreadsFromData(data);
    return threads ? cloneThreads(threads) : null;
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    if (this.scope.isDisposed()) return null;
    return this.threadListSnapshot("archived");
  }

  observeActiveThreadsResult(
    listener: ObservedPaginatedResultListener<readonly Thread[]>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    this.scope.assertUsable();
    const observer = new InfiniteQueryObserver<ThreadPage, Error, readonly Thread[], ActiveThreadsQueryKey, ActiveThreadCursor>(
      this.scope.client,
      {
        ...this.activeThreadsQueryOptions(),
        select: selectActiveThreads,
        enabled: false,
      },
    );
    const emit = (result: InfiniteQueryObserverResult<readonly Thread[]>): void => {
      if (!this.scope.isDisposed()) listener(this.projectObservedActiveThreadsResult(result));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return this.scope.trackObserver(() => {
      unsubscribe();
      observer.destroy();
    });
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.scope.assertUsable();
    return this.scope.observeResult(this.archivedThreadsQueryOptions(), cloneThreads, listener, options);
  }

  async fetchActiveThreads(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const frozenSnapshot = this.activeThreadsFrozenSnapshot();
    if (frozenSnapshot) return frozenSnapshot;
    try {
      const data = await this.scope.client.infiniteQuery(this.activeThreadsQueryOptions());
      return cloneThreads(activeThreadsFromData(data) ?? []);
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
    };
    return this.scope.client.query(options).then(cloneThreads);
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
      return cloneThreads(await this.scope.client.query(this.archivedThreadsQueryOptions()));
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
    const activeChanges = changes.filter((change) => change.list === "active");
    if (activeChanges.length > 0) {
      const key = ACTIVE_THREADS_QUERY_KEY;
      const before = this.scope.client.getQueryData<ActiveThreadData>(key);
      const after = activeChanges.reduce<ActiveThreadData | undefined>(applyActiveThreadMutation, before);
      this.publishThreadProjection(key, activeChanges, before, after, {
        invalidate: activeChanges.some(activeThreadChangeInvalidatesPages),
        refresh: () => this.refreshActiveThreads(),
      });
    }

    const archivedChanges = changes.filter((change) => change.list === "archived");
    if (archivedChanges.length > 0) {
      const key = ARCHIVED_THREADS_QUERY_KEY;
      const before = this.scope.client.getQueryData<readonly Thread[]>(key);
      const after = archivedChanges.reduce<readonly Thread[] | null>(applyThreadCatalogChange, before ?? null) ?? undefined;
      this.publishThreadProjection(key, archivedChanges, before, after === before ? before : after && cloneThreads(after), {
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

  private threadListSnapshot(kind: ThreadCatalogList): readonly Thread[] | null {
    if (kind === "active") return this.activeThreadsSnapshot();
    const threads = this.scope.client.getQueryData<readonly Thread[]>(ARCHIVED_THREADS_QUERY_KEY);
    return threads ? cloneThreads(threads) : null;
  }

  private activeThreadsFrozenSnapshot(): readonly Thread[] | undefined {
    if (this.activeThreadsFreezeCount === 0) return undefined;
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
        this.scope
          .runWithClient((client) => listThreads(client, this.scope.context.vaultPath, { archived: true, signal }))
          .then(cloneThreads),
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

function selectActiveThreads(data: ActiveThreadData): readonly Thread[] {
  return activeThreadsFromData(data) ?? [];
}

function activeThreadChangeInvalidatesPages(change: ThreadCatalogChange): boolean {
  return change.kind !== "update" || Object.hasOwn(change.changes, "isPinned") || Object.hasOwn(change.changes, "recencyAt");
}
