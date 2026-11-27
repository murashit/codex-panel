import {
  CancelledError,
  InfiniteQueryObserver,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
} from "@tanstack/query-core";
import { applyThreadCatalogChange, type ThreadCatalogChange, threadCatalogChangeList } from "../../domain/threads/catalog";
import type { ThreadFact, ThreadFactSink } from "../../domain/threads/facts";
import type { Thread } from "../../domain/threads/model";
import type { ObservedPaginatedResult, ObservedPaginatedResultListener, ResultObservation } from "../../shared/async/observed-result";
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
const SEARCH_QUERY_KEY = ["threads", "search"] as const;
const ARCHIVED_THREADS_QUERY_KEY = ["threads", "archived"] as const;

type ActiveThreadsQueryKey = typeof ACTIVE_THREADS_QUERY_KEY;

interface PendingReplacement {
  readonly sourceThreadId: string;
  source: Thread | undefined;
  childId?: string;
  identifying?: Promise<void>;
  readonly facts: ThreadFact[];
  finished: boolean;
}

export class ThreadCatalog {
  private requestedPageCount: number | undefined;
  private replacements: PendingReplacement[] = [];

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

  private replacementFor(id: string): PendingReplacement | undefined {
    return this.replacements.find((pending) => pending.sourceThreadId === id || pending.childId === id);
  }

  private acceptFacts(facts: readonly ThreadFact[]): void {
    const immediate: ThreadFact[] = [];
    for (const fact of facts) {
      const pending = this.replacementFor(threadIdForFact(fact));
      if (!pending || pending.finished) immediate.push(fact);
      else pending.facts.push(fact);
    }
    this.publishFacts(immediate);
  }

  private publishFacts(facts: readonly ThreadFact[]): void {
    if (this.scope.isDisposed() || facts.length === 0) return;
    this.applyThreadCatalogChanges(
      projectThreadFacts({ active: this.knownActiveThreads(), archived: this.archivedThreadsSnapshot() }, facts),
    );
    this.onPublishedFacts(facts);
  }

  private knownActiveThreads(): readonly Thread[] {
    const active = this.activeThreadsSnapshot() ?? [];
    const searched = this.scope.client.getQueryData<readonly Thread[]>(SEARCH_QUERY_KEY) ?? [];
    const sources = this.replacements.flatMap((pending) => pending.source ?? []);
    return active.concat(searched, sources);
  }

  visibleThreadId(visibleThreads: readonly Thread[], threadId: string | null): string | null {
    if (!threadId) return null;
    const pending = this.replacementFor(threadId);
    if (pending?.childId !== threadId) return threadId;
    const replacementVisible = visibleThreads.some((thread) => thread.id === threadId);
    const sourceVisible = visibleThreads.some((thread) => thread.id === pending.sourceThreadId);
    return !replacementVisible && sourceVisible ? pending.sourceThreadId : threadId;
  }

  beginReplacement(sourceThreadId: string, mode: "create" | "retry" = "create") {
    this.scope.assertUsable();
    if (this.replacementFor(sourceThreadId)) throw new Error("A replacement publication is already in progress for this thread.");
    const source = this.knownActiveThreads().find((thread) => thread.id === sourceThreadId);
    const pending: PendingReplacement = { sourceThreadId, source, facts: [], finished: false };
    let identified: (() => void) | undefined;
    if (mode === "create") {
      pending.identifying = new Promise<void>((resolve) => {
        identified = this.scope.trackObserver(() => {
          delete pending.identifying;
          resolve();
        });
      });
    }
    this.replacements.push(pending);
    return {
      attach: (replacementThread: Thread) => {
        if (pending.finished) throw new Error("The replacement publication has already finished.");
        if (pending.childId) throw new Error("A replacement thread is already attached.");
        if (this.replacementFor(replacementThread.id)) throw new Error("A replacement publication is already in progress for this thread.");
        pending.childId = replacementThread.id;
        pending.facts.unshift({ type: "thread-upserted", thread: replacementThread });
        identified?.();
      },
      finish: (sourceArchived: boolean) => {
        if (pending.finished) return;
        pending.finished = true;
        identified?.();
        if (sourceArchived && !pending.facts.some((fact) => factRemovesThread(fact, sourceThreadId))) {
          pending.facts.push({ type: "thread-archived", threadId: sourceThreadId });
        }
        try {
          this.publishFacts(pending.facts);
        } finally {
          this.replacements = this.replacements.filter((replacement) => replacement !== pending);
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

  watchArchivedThreads(changed: () => void): ResultObservation<readonly Thread[]> {
    return this.scope.watchResult(this.listQueryOptions("archived"), (threads) => threads, changed);
  }

  async fetchActiveThreads(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    await this.settleRead(ACTIVE_THREADS_QUERY_KEY, this.scope.client.infiniteQuery(this.activeThreadsQueryOptions()));
    return this.activeThreadsSnapshot() ?? [];
  }

  async refreshActiveThreads(): Promise<void> {
    this.scope.assertUsable();
    const key = ACTIVE_THREADS_QUERY_KEY;
    this.requestedPageCount = undefined;
    if (this.scope.client.getQueryState(key)?.fetchMeta?.fetchMore?.direction === "forward") {
      await this.scope.client.cancelQueries({ queryKey: key, exact: true });
    }
    await this.scope.client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    this.scope.assertUsable();
    await this.fetchActiveThreads();
  }

  watchActiveThreadSearch(changed: () => void): ResultObservation<readonly Thread[]> {
    const observation = this.scope.watchResult(this.listQueryOptions("active"), (rows) => rows, changed);
    const filters = { queryKey: SEARCH_QUERY_KEY, exact: true };
    return {
      read: () => observation.read(),
      close: () => {
        observation.close();
        if (!this.scope.client.getQueryCache().find(filters)?.getObserversCount()) this.scope.client.removeQueries(filters);
      },
    };
  }

  fetchActiveThreadSearch(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    return this.scope.client.query(this.listQueryOptions("active"));
  }

  hasMoreActiveThreads(): boolean {
    if (this.scope.isDisposed()) return false;
    return activeThreadDataHasMore(this.scope.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY));
  }

  async loadMoreActiveThreads(): Promise<void> {
    this.scope.assertUsable();
    const key = ACTIVE_THREADS_QUERY_KEY;
    const state = this.scope.client.getQueryState<ActiveThreadData>(key);
    if (!state?.data || state.isInvalidated) await this.fetchActiveThreads();
    const current = this.scope.client.getQueryState<ActiveThreadData>(key);
    if (!current?.data || current.isInvalidated || !activeThreadDataHasMore(current.data)) return;
    const observer = new InfiniteQueryObserver(this.scope.client, { ...this.activeThreadsQueryOptions(), enabled: false });
    const requested = current.data.pages.length + 1;
    this.requestedPageCount = requested;
    try {
      await this.settleRead(key, observer.fetchNextPage({ cancelRefetch: false, throwOnError: true }));
    } finally {
      if (this.requestedPageCount === requested) this.requestedPageCount = undefined;
      observer.destroy();
    }
  }

  async refreshArchivedThreads(): Promise<readonly Thread[]> {
    this.scope.assertUsable();
    await this.settleRead(ARCHIVED_THREADS_QUERY_KEY, this.scope.client.query({ ...this.listQueryOptions("archived"), staleTime: 0 }));
    return this.archivedThreadsSnapshot() ?? [];
  }

  private async settleRead(key: readonly unknown[], read: Promise<unknown>): Promise<void> {
    // Exact facts can supersede a read more than once. Follow whichever fetch now owns the result.
    let pending: Promise<unknown> | undefined = read;
    while (pending) {
      try {
        await pending;
      } catch (error) {
        if (!(error instanceof CancelledError)) throw error;
      }
      this.scope.assertUsable();
      const query = this.scope.client.getQueryCache().find({ queryKey: key, exact: true });
      pending = query?.state.fetchStatus === "fetching" ? query.promise : undefined;
    }
  }

  applyThreadCatalogChanges(changes: readonly ThreadCatalogChange[]): void {
    this.scope.assertUsable();
    if (changes.length === 0) return;
    const activeChanges = changes.filter((change) => threadCatalogChangeList(change) === "active");
    if (activeChanges.length > 0) {
      const key = ACTIVE_THREADS_QUERY_KEY;
      const before = this.scope.client.getQueryData<ActiveThreadData>(key);
      const pages = this.requestedPageCount ?? before?.pages.length ?? 1;
      const after = activeChanges.reduce<ActiveThreadData | undefined>(applyActiveThreadMutation, before);
      this.publishThreadProjection(key, activeChanges, before, after, {
        invalidate: activeChanges.some(activeThreadChangeInvalidatesPages),
        refresh: () => this.scope.client.infiniteQuery({ ...this.activeThreadsQueryOptions(), staleTime: 0, pages }),
      });
    }

    const archivedChanges = changes.filter((change) => threadCatalogChangeList(change) === "archived");
    if (archivedChanges.length > 0) {
      this.publishListChanges("archived", archivedChanges);
    }
    if (activeChanges.length && this.scope.client.getQueryState(SEARCH_QUERY_KEY)) {
      this.publishListChanges("active", activeChanges);
    }
  }

  private publishListChanges(list: "active" | "archived", changes: readonly ThreadCatalogChange[]): void {
    const options = this.listQueryOptions(list);
    const before = this.scope.client.getQueryData<readonly Thread[]>(options.queryKey);
    const after = changes.reduce<readonly Thread[] | null>(applyThreadCatalogChange, before ?? null) ?? undefined;
    this.publishThreadProjection(options.queryKey, changes, before, after, {
      invalidate: false,
      refresh: () => this.scope.client.query({ ...options, staleTime: 0 }),
    });
  }

  private publishThreadProjection<T>(
    key: readonly unknown[],
    changes: readonly ThreadCatalogChange[],
    before: T | undefined,
    after: T | undefined,
    options: { invalidate: boolean; refresh: () => Promise<unknown> },
  ): void {
    const query = this.scope.client.getQueryCache().find<unknown, Error, T>({ queryKey: key, exact: true });
    const fetchIsRunning = query?.state.fetchStatus === "fetching";
    const refreshRequired =
      fetchIsRunning ||
      changes.some((change) => change.kind === "revalidate") ||
      (before === undefined && changes.some((change) => change.kind === "upsert"));
    if (fetchIsRunning) void query.cancel({ revert: true });
    if (after !== before) query?.setState({ data: after });
    if (options.invalidate) query?.invalidate();
    if (refreshRequired) {
      void options.refresh().catch(() => {
        // Query observers retain refresh failures while exact facts remain last-known-good state.
      });
    }
  }

  private async publishedRows(
    rows: readonly Thread[],
    list: "active" | "archived",
    signal: AbortSignal,
    previousRows?: readonly Thread[],
  ): Promise<readonly Thread[]> {
    signal.throwIfAborted();
    if (this.replacements.length === 0) return rows;
    const waiting = this.replacements.flatMap((pending) => pending.identifying ?? []);
    if (list === "active" && waiting.length) {
      // thread/list omits fork lineage. An unfamiliar active row may be the child until thread/fork replies.
      const knownIds = new Set([...this.knownActiveThreads(), ...(this.archivedThreadsSnapshot() ?? [])].map((thread) => thread.id));
      if (rows.some((row) => !knownIds.has(row.id) && !this.replacementFor(row.id))) await Promise.all(waiting);
      signal.throwIfAborted();
    }
    const visible: Thread[] = [];
    const missing = new Set(this.replacements);
    for (const row of rows) {
      const pending = this.replacementFor(row.id);
      if (!pending || pending.finished) visible.push(row);
      else if (list === "active") {
        if (row.id === pending.sourceThreadId) pending.source ??= row;
        if (pending.source && missing.delete(pending)) visible.push(pending.source);
      }
    }
    // A refresh can lose both rows when the server moves them across a page boundary.
    if (list === "active") {
      for (const pending of missing) {
        if (!pending.finished && pending.source && (!previousRows || previousRows.some((row) => row.id === pending.sourceThreadId))) {
          visible.push(pending.source);
        }
      }
    }
    return visible;
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
        if (!this.replacements.length) return page;
        // Refetching may replace the cursor chain that originally contained the source.
        const previous = pageParam === null ? (this.activeThreadsSnapshot() ?? []) : [];
        const threads = await this.publishedRows(page.threads, "active", signal, previous);
        return { ...page, threads };
      },
      initialPageParam: null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    };
  }

  private listQueryOptions(list: "active" | "archived"): AppServerQueryOptions<readonly Thread[]> {
    const archived = list === "archived";
    return {
      queryKey: archived ? ARCHIVED_THREADS_QUERY_KEY : SEARCH_QUERY_KEY,
      queryFn: async ({ signal }) => {
        const rows = await this.scope.runWithClient((client) => listThreads(client, this.scope.context.vaultPath, { archived, signal }));
        return this.publishedRows(rows, list, signal);
      },
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
