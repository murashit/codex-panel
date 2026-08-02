import {
  CancelledError,
  InfiniteQueryObserver,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
  QueryObserver,
  type QueryObserverResult,
} from "@tanstack/query-core";
import { applyThreadCatalogChange, type ThreadCatalogChange, type ThreadCatalogList } from "../../domain/threads/catalog-read-model";
import type { Thread } from "../../domain/threads/model";
import type {
  ObservedPaginatedResult,
  ObservedPaginatedResultListener,
  ObservedResult,
  ObservedResultListener,
} from "../../shared/runtime/observed-result";
import { listThreads, readThreadPage, type ThreadPage } from "../services/threads";
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
  constructor(private readonly scope: AppServerQueryScope) {}

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
    const observer = new InfiniteQueryObserver(this.scope.client, {
      ...this.activeThreadsQueryOptions(),
      enabled: false,
    });
    const emit = (result: InfiniteQueryObserverResult<ActiveThreadData>): void => {
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
    return this.observeQueryResult(this.archivedThreadsQueryOptions(), cloneThreads, listener, options);
  }

  async fetchActiveThreads(options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const key = ACTIVE_THREADS_QUERY_KEY;
    if (options.force) {
      if (this.scope.client.getQueryState(key)?.fetchMeta?.fetchMore?.direction === "forward") {
        await this.scope.client.cancelQueries({ queryKey: key, exact: true });
      }
      await this.scope.client.invalidateQueries({ queryKey: key, refetchType: "none" });
      this.scope.assertUsable();
    }
    return this.readThroughQueryCancellation(
      async () => {
        const data = await this.scope.client.fetchInfiniteQuery(this.activeThreadsQueryOptions());
        return cloneThreads(activeThreadsFromData(data) ?? []);
      },
      () => this.activeThreadsSnapshot(),
    );
  }

  refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.fetchActiveThreads({ force: true });
  }

  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const key = ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY;
    const options = {
      queryKey: key,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.scope.runWithClient((client) => listThreads(client, this.scope.context.vaultPath, { signal })),
    };
    return this.readFreshThroughQueryCancellation(key, async () => cloneThreads(await this.scope.client.fetchQuery(options)));
  }

  hasMoreActiveThreads(): boolean {
    if (this.scope.isDisposed()) return false;
    return activeThreadDataHasMore(this.scope.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY));
  }

  async loadMoreActiveThreads(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const current = this.activeThreadsSnapshot() ?? (await this.fetchActiveThreads());
    const observer = new InfiniteQueryObserver(this.scope.client, {
      ...this.activeThreadsQueryOptions(),
      enabled: false,
    });
    try {
      if (!observer.getCurrentResult().hasNextPage) return current;
      const result = await observer.fetchNextPage({ cancelRefetch: false, throwOnError: true });
      return result.data ? cloneThreads(activeThreadsFromData(result.data) ?? []) : current;
    } catch (error) {
      if (error instanceof CancelledError) return this.activeThreadsSnapshot() ?? current;
      throw error;
    } finally {
      observer.destroy();
    }
  }

  refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.fetchArchivedThreads({ force: true });
  }

  async fetchArchivedThreads(options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    const key = ARCHIVED_THREADS_QUERY_KEY;
    if (options.force) {
      await this.scope.client.invalidateQueries({ queryKey: key, refetchType: "none" });
      this.scope.assertUsable();
    }
    return this.readFreshThroughQueryCancellation(key, async () =>
      cloneThreads(await this.scope.client.fetchQuery(this.archivedThreadsQueryOptions())),
    );
  }

  applyThreadCatalogChanges(changes: readonly ThreadCatalogChange[]): void {
    this.scope.assertUsable();
    if (changes.length === 0) return;
    const activeChanges = changes.filter((change) => change.list === "active");
    if (activeChanges.length > 0) {
      const key = ACTIVE_THREADS_QUERY_KEY;
      const before = this.scope.client.getQueryData<ActiveThreadData>(key);
      const after = activeChanges.reduce<ActiveThreadData | undefined>(applyActiveThreadMutation, before);
      const revalidationRequested = activeChanges.some((change) => change.kind === "revalidate");
      const missingSnapshotUpsert = before === undefined && activeChanges.some((change) => change.kind === "upsert");
      const fetchIsNextPage = this.scope.client.getQueryState(key)?.fetchMeta?.fetchMore?.direction === "forward";
      if (before === undefined || after !== before || revalidationRequested || activeThreadDataHasMore(before) || fetchIsNextPage) {
        const wasFetching = this.scope.client.getQueryState(key)?.fetchStatus === "fetching";
        void this.scope.client.cancelQueries({ queryKey: key, exact: true });
        if (after !== before) this.scope.client.setQueryData(key, after);
        void this.scope.client.invalidateQueries({ queryKey: key, refetchType: "none" });
        const searchKey = ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY;
        void this.scope.client.cancelQueries({ queryKey: searchKey, exact: true });
        void this.scope.client.invalidateQueries({ queryKey: searchKey, refetchType: "none" });

        if ((missingSnapshotUpsert && !fetchIsNextPage) || (wasFetching && !fetchIsNextPage) || (revalidationRequested && before)) {
          void this.fetchActiveThreads({ force: true }).catch(() => {
            // Query observers retain refresh failures while the event projection remains last-known-good state.
          });
        }
      }
    }

    const archivedChanges = changes.filter((change) => change.list === "archived");
    if (archivedChanges.length > 0) {
      const key = ARCHIVED_THREADS_QUERY_KEY;
      const before = this.archivedThreadsSnapshot();
      const after = archivedChanges.reduce<readonly Thread[] | null>(applyThreadCatalogChange, before);
      const revalidationRequested = archivedChanges.some((change) => change.kind === "revalidate");
      if (before !== null && after === before && !revalidationRequested) return;
      const wasFetching = this.scope.client.getQueryState(key)?.fetchStatus === "fetching";
      void this.scope.client.cancelQueries({ queryKey: key, exact: true });
      if (after !== before && after) this.scope.client.setQueryData(key, cloneThreads(after));
      void this.scope.client.invalidateQueries({ queryKey: key, refetchType: "none" });

      if (wasFetching || (revalidationRequested && before)) {
        void this.fetchArchivedThreads({ force: true }).catch(() => {
          // Query observers retain refresh failures while the event projection remains last-known-good state.
        });
      }
    }
  }

  private threadListSnapshot(kind: ThreadCatalogList): readonly Thread[] | null {
    if (kind === "active") return this.activeThreadsSnapshot();
    const threads = this.scope.client.getQueryData<readonly Thread[]>(ARCHIVED_THREADS_QUERY_KEY);
    return threads ? cloneThreads(threads) : null;
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
              isPinned: false,
            });
          }
          const [pinnedThreads, unpinnedPage] = await Promise.all([
            listThreads(client, this.scope.context.vaultPath, { archived: false, isPinned: true, signal }),
            readThreadPage(client, this.scope.context.vaultPath, { archived: false, isPinned: false }),
          ]);
          return {
            ...unpinnedPage,
            threads: [...pinnedThreads, ...unpinnedPage.threads],
            fetchedSize: pinnedThreads.length + unpinnedPage.fetchedSize,
          };
        });
        signal.throwIfAborted();
        return page;
      },
      initialPageParam: null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: Number.POSITIVE_INFINITY,
    };
  }

  private archivedThreadsQueryOptions(): AppServerQueryOptions<readonly Thread[]> {
    return {
      queryKey: ARCHIVED_THREADS_QUERY_KEY,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.scope
          .runWithClient((client) => listThreads(client, this.scope.context.vaultPath, { archived: true, signal }))
          .then(cloneThreads),
      staleTime: Number.POSITIVE_INFINITY,
    };
  }

  private observeQueryResult<TQuery, TValue>(
    queryOptions: AppServerQueryOptions<TQuery>,
    project: (value: TQuery) => TValue,
    listener: ObservedResultListener<TValue>,
    options: { emitCurrent?: boolean },
  ): () => void {
    const observer = new QueryObserver<TQuery>(this.scope.client, {
      ...queryOptions,
      enabled: false,
    });
    const emit = (result: QueryObserverResult<TQuery>): void => {
      if (!this.scope.isDisposed()) listener(this.projectObservedResult(result, project));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return this.scope.trackObserver(() => {
      unsubscribe();
      observer.destroy();
    });
  }

  private projectObservedResult<TQuery, TValue>(
    result: QueryObserverResult<TQuery>,
    project: (value: TQuery) => TValue,
  ): ObservedResult<TValue> {
    return {
      value: result.data === undefined ? null : project(result.data),
      error: result.error instanceof Error ? result.error : null,
      isFetching: result.isFetching,
    };
  }

  private projectObservedActiveThreadsResult(
    result: InfiniteQueryObserverResult<ActiveThreadData>,
  ): ObservedPaginatedResult<readonly Thread[]> {
    const threads = activeThreadsFromData(result.data);
    return {
      value: threads ? cloneThreads(threads) : null,
      error: result.error instanceof Error ? result.error : null,
      isFetching: result.isFetching,
      hasMore: result.hasNextPage,
      isFetchingNextPage: result.isFetchingNextPage,
    };
  }

  private async readThroughQueryCancellation<T>(read: () => Promise<T>, fallback?: () => T | null): Promise<T> {
    for (;;) {
      try {
        const value = await read();
        return value;
      } catch (error) {
        if (!(error instanceof CancelledError)) throw error;
        this.scope.assertUsable();
        const fallbackValue = fallback?.();
        if (fallbackValue != null) return fallbackValue;
      }
    }
  }

  private async readFreshThroughQueryCancellation<T>(queryKey: readonly unknown[], read: () => Promise<T>): Promise<T> {
    for (;;) {
      const value = await this.readThroughQueryCancellation(read);
      if (!this.scope.client.getQueryState(queryKey)?.isInvalidated) return value;
    }
  }
}
