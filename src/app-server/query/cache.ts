import {
  CancelledError,
  InfiniteQueryObserver,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
  QueryClient,
  QueryObserver,
  type QueryObserverResult,
} from "@tanstack/query-core";
import type { ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import { cloneRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../domain/runtime/permissions";
import {
  createMetadataResourceDiagnostics,
  createServerDiagnostics,
  type DiagnosticProbeResult,
  diagnosticProbeError,
  diagnosticProbeOk,
  type MetadataResourceDiagnostics,
} from "../../domain/server/diagnostics";
import type {
  SharedServerMetadataResource,
  SharedServerMetadataResourceFor,
  SharedServerMetadataResourceId,
  SharedServerMetadataSnapshotValues,
} from "../../domain/server/metadata";
import { applyThreadCatalogChange, type ThreadCatalogChange, type ThreadCatalogList } from "../../domain/threads/catalog-read-model";
import type { Thread } from "../../domain/threads/model";
import { StaleExecutionRuntimeError } from "../../shared/runtime/execution-runtime-lifetime";
import type {
  ObservedPaginatedResult,
  ObservedPaginatedResultListener,
  ObservedResult,
  ObservedResultListener,
} from "../../shared/runtime/observed-result";
import type { AppServerClient } from "../connection/client";
import type { AppServerClientAccess, AppServerClientAccessOptions } from "../connection/client-access";
import type { AppServerExecutionContext } from "../connection/execution-context";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { listModelMetadata } from "../services/catalog";
import { readPermissionProfileMetadataProbe, readRateLimitMetadataProbe, readSkillMetadataProbe } from "../services/metadata-probes";
import { readEffectiveConfig } from "../services/runtime-metadata";
import { listThreads, readThreadPage, type ThreadPage } from "../services/threads";
import {
  type ActiveThreadCursor,
  type ActiveThreadData,
  activeThreadDataHasMore,
  activeThreadsFromData,
  applyActiveThreadMutation,
  recentActiveThreadsFromData,
} from "./active-thread-inventory";
import { cloneModelMetadata, cloneRateLimitSnapshot, cloneSharedServerMetadataResource, cloneThreads } from "./snapshots";

const MODELS_STALE_TIME_MS = 60_000;
const ACTIVE_THREADS_QUERY_KEY = ["threads", "active"] as const;
const ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY = ["threads", "active-search-inventory"] as const;
const ARCHIVED_THREADS_QUERY_KEY = ["threads", "archived"] as const;
const MODELS_QUERY_KEY = ["models"] as const;
const RUNTIME_CONFIG_QUERY_KEY = ["runtime-config"] as const;
const SKILLS_QUERY_KEY = ["skills"] as const;
const PERMISSION_PROFILES_QUERY_KEY = ["permission-profiles"] as const;
const RATE_LIMITS_QUERY_KEY = ["rate-limits"] as const;

interface AppServerQueryOptions<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: (context: { signal: AbortSignal }) => Promise<T>;
  readonly staleTime?: number;
}

type ActiveThreadsQueryKey = typeof ACTIVE_THREADS_QUERY_KEY;

interface MetadataResourceSnapshot<T> {
  readonly value: T;
  readonly probe: DiagnosticProbeResult;
}

type MetadataResourceKind = "skills" | "permissionProfiles" | "rateLimits";
type MetadataResourceValue = readonly SkillMetadata[] | readonly RuntimePermissionProfileSummary[] | RateLimitSnapshot | null;

interface MetadataQueryData {
  readonly runtimeConfig: RuntimeConfigSnapshot;
  readonly models: readonly ModelMetadata[];
  readonly skills: MetadataResourceSnapshot<readonly SkillMetadata[]>;
  readonly permissionProfiles: MetadataResourceSnapshot<readonly RuntimePermissionProfileSummary[]>;
  readonly rateLimits: MetadataResourceSnapshot<RateLimitSnapshot | null>;
}

type MetadataResourceDescriptor<Id extends SharedServerMetadataResourceId> = {
  readonly queryOptions: () => AppServerQueryOptions<MetadataQueryData[Id]>;
  readonly project: (result: QueryObserverResult<MetadataQueryData[Id]>) => SharedServerMetadataResourceFor<Id>;
  readonly snapshot: (data: MetadataQueryData[Id]) => SharedServerMetadataSnapshotValues[Id];
};

type MetadataResourceDescriptors = {
  readonly [Id in SharedServerMetadataResourceId]: MetadataResourceDescriptor<Id>;
};

export class AppServerQueryCache {
  private readonly context: Readonly<AppServerExecutionContext>;
  private readonly client: QueryClient;
  private readonly clientAccess: AppServerClientAccess;
  private readonly metadataDescriptors: MetadataResourceDescriptors;
  private readonly observerUnsubscribes = new Set<() => void>();
  private disposed = false;

  constructor(context: AppServerExecutionContext, clientAccess: AppServerClientAccess) {
    this.context = Object.freeze({ ...context });
    this.client = createAppServerQueryClient();
    this.clientAccess = clientAccess;
    this.metadataDescriptors = this.createMetadataResourceDescriptors();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of [...this.observerUnsubscribes]) unsubscribe();
    this.observerUnsubscribes.clear();
    this.client.clear();
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    if (this.disposed) return null;
    const data = this.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY);
    const threads = activeThreadsFromData(data);
    return threads ? cloneThreads(threads) : null;
  }

  recentActiveThreadsSnapshot(): readonly Thread[] | null {
    if (this.disposed) return null;
    const data = this.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY);
    const threads = recentActiveThreadsFromData(data);
    return threads ? cloneThreads(threads) : null;
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    if (this.disposed) return null;
    return this.threadListSnapshot("archived");
  }

  observeActiveThreadsResult(
    listener: ObservedPaginatedResultListener<readonly Thread[]>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    this.assertUsable();
    const observer = new InfiniteQueryObserver(this.client, {
      ...this.activeThreadsQueryOptions(),
      enabled: false,
    });
    const emit = (result: InfiniteQueryObserverResult<ActiveThreadData>): void => {
      if (!this.disposed) listener(this.projectObservedActiveThreadsResult(result));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return this.trackObserver(() => {
      unsubscribe();
      observer.destroy();
    });
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.assertUsable();
    return this.observeQueryResult(this.archivedThreadsQueryOptions(), cloneThreads, listener, options);
  }

  fetchActiveThreads(options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    return this.runWhileActive(async () => {
      const key = ACTIVE_THREADS_QUERY_KEY;
      if (options.force) {
        if (this.client.getQueryState(key)?.fetchMeta?.fetchMore?.direction === "forward") {
          await this.client.cancelQueries({ queryKey: key, exact: true });
        }
        await this.client.invalidateQueries({ queryKey: key, refetchType: "none" });
        this.assertUsable();
      }
      return this.readThroughQueryCancellation(
        async () => {
          const data = await this.client.fetchInfiniteQuery(this.activeThreadsQueryOptions());
          return cloneThreads(activeThreadsFromData(data) ?? []);
        },
        () => this.activeThreadsSnapshot(),
      );
    });
  }

  refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.fetchActiveThreads({ force: true });
  }

  fetchActiveThreadSearchInventory(): Promise<readonly Thread[]> {
    return this.runWhileActive(async () => {
      const key = ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY;
      const options = {
        queryKey: key,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          this.runWithClient((client) => listThreads(client, this.context.vaultPath, { signal })),
      };
      return this.readFreshThroughQueryCancellation(key, async () => cloneThreads(await this.client.fetchQuery(options)));
    });
  }

  hasMoreActiveThreads(): boolean {
    if (this.disposed) return false;
    return activeThreadDataHasMore(this.client.getQueryData<ActiveThreadData>(ACTIVE_THREADS_QUERY_KEY));
  }

  loadMoreActiveThreads(): Promise<readonly Thread[]> {
    return this.runWhileActive(async () => {
      const current = this.activeThreadsSnapshot() ?? (await this.fetchActiveThreads());
      const observer = new InfiniteQueryObserver(this.client, {
        ...this.activeThreadsQueryOptions(),
        enabled: false,
      });
      try {
        if (!observer.getCurrentResult().hasNextPage) return current;
        const result = await observer.fetchNextPage({ cancelRefetch: false, throwOnError: true });
        this.assertUsable();
        return result.data ? cloneThreads(activeThreadsFromData(result.data) ?? []) : current;
      } catch (error) {
        if (error instanceof CancelledError) return this.activeThreadsSnapshot() ?? current;
        throw error;
      } finally {
        observer.destroy();
      }
    });
  }

  refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.fetchArchivedThreads({ force: true });
  }

  fetchArchivedThreads(options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    return this.runWhileActive(async () => {
      const key = ARCHIVED_THREADS_QUERY_KEY;
      if (options.force) {
        await this.client.invalidateQueries({ queryKey: key, refetchType: "none" });
        this.assertUsable();
      }
      return this.readFreshThroughQueryCancellation(key, async () =>
        cloneThreads(await this.client.fetchQuery(this.archivedThreadsQueryOptions())),
      );
    });
  }

  applyThreadCatalogChanges(changes: readonly ThreadCatalogChange[]): void {
    this.assertUsable();
    if (changes.length === 0) return;
    const activeChanges = changes.filter((change) => change.list === "active");
    if (activeChanges.length > 0) {
      const key = ACTIVE_THREADS_QUERY_KEY;
      const before = this.client.getQueryData<ActiveThreadData>(key);
      const after = activeChanges.reduce<ActiveThreadData | undefined>(applyActiveThreadMutation, before);
      const revalidationRequested = activeChanges.some((change) => change.kind === "revalidate");
      const missingSnapshotUpsert = before === undefined && activeChanges.some((change) => change.kind === "upsert");
      const fetchIsNextPage = this.client.getQueryState(key)?.fetchMeta?.fetchMore?.direction === "forward";
      if (before === undefined || after !== before || revalidationRequested || activeThreadDataHasMore(before) || fetchIsNextPage) {
        const wasFetching = this.client.getQueryState(key)?.fetchStatus === "fetching";
        void this.client.cancelQueries({ queryKey: key, exact: true });
        if (after !== before) this.client.setQueryData(key, after);
        void this.client.invalidateQueries({ queryKey: key, refetchType: "none" });
        const searchKey = ACTIVE_THREAD_SEARCH_INVENTORY_QUERY_KEY;
        void this.client.cancelQueries({ queryKey: searchKey, exact: true });
        void this.client.invalidateQueries({ queryKey: searchKey, refetchType: "none" });

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
      const wasFetching = this.client.getQueryState(key)?.fetchStatus === "fetching";
      void this.client.cancelQueries({ queryKey: key, exact: true });
      if (after !== before && after) this.client.setQueryData(key, cloneThreads(after));
      void this.client.invalidateQueries({ queryKey: key, refetchType: "none" });

      if (wasFetching || (revalidationRequested && before)) {
        void this.fetchArchivedThreads({ force: true }).catch(() => {
          // Query observers retain refresh failures while the event projection remains last-known-good state.
        });
      }
    }
  }

  private threadListSnapshot(kind: ThreadCatalogList): readonly Thread[] | null {
    if (kind === "active") return this.activeThreadsSnapshot();
    const threads = this.client.getQueryData<readonly Thread[]>(ARCHIVED_THREADS_QUERY_KEY);
    return threads ? cloneThreads(threads) : null;
  }

  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics {
    if (this.disposed) return createMetadataResourceDiagnostics();
    const skills = this.metadataResourceState("skills");
    const permissionProfiles = this.metadataResourceState("permissionProfiles");
    const rateLimits = this.metadataResourceState("rateLimits");
    return {
      probes: {
        models: this.modelsProbe(),
        skills: skills.probe,
        permissionProfiles: permissionProfiles.probe,
        rateLimits: rateLimits.probe,
      },
    };
  }

  metadataSnapshot<Id extends SharedServerMetadataResourceId>(id: Id): SharedServerMetadataSnapshotValues[Id] {
    if (this.disposed) return (id === "rateLimits" ? undefined : null) as SharedServerMetadataSnapshotValues[Id];
    const descriptor = this.metadataDescriptor(id);
    const data = this.client.getQueryData<MetadataQueryData[Id]>(descriptor.queryOptions().queryKey);
    return data === undefined
      ? ((id === "rateLimits" ? undefined : null) as SharedServerMetadataSnapshotValues[Id])
      : descriptor.snapshot(data);
  }

  observeMetadataResource<Id extends SharedServerMetadataResourceId>(
    id: Id,
    listener: (resource: SharedServerMetadataResourceFor<Id>) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    this.assertUsable();
    const descriptor = this.metadataDescriptor(id);
    return this.observeMetadataQueryResource(descriptor.queryOptions(), descriptor.project, listener, options);
  }

  refreshAppServerMetadata(): Promise<void> {
    return this.runWhileActive(async () => {
      const runtimeResult = this.fetchRuntimeConfig().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const [, runtime] = await Promise.all([
        Promise.allSettled([
          this.fetchMetadataResource("skills"),
          this.fetchMetadataResource("permissionProfiles"),
          this.fetchMetadataResource("rateLimits"),
          this.fetchModels({ force: true }),
        ]),
        runtimeResult,
      ]);
      this.assertUsable();
      if (!runtime.ok) throw runtime.error;
    });
  }

  refreshSkills(): Promise<void> {
    return this.runWhileActive(async () => {
      await this.fetchMetadataResource("skills");
      this.assertUsable();
    });
  }

  refreshRateLimits(): Promise<void> {
    return this.runWhileActive(async () => {
      await this.fetchMetadataResource("rateLimits");
      this.assertUsable();
    });
  }

  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.assertUsable();
    return this.observeQueryResult(this.metadataDescriptor("models").queryOptions(), cloneModelMetadata, listener, options);
  }

  fetchModels(options: { force?: boolean } = {}): Promise<readonly ModelMetadata[]> {
    return this.runWhileActive(async () => {
      const descriptor = this.metadataDescriptor("models");
      const key = descriptor.queryOptions().queryKey;
      if (options.force) {
        await this.client.invalidateQueries({ queryKey: key, refetchType: "none" });
        this.assertUsable();
      }
      const models = await this.client.fetchQuery(descriptor.queryOptions());
      this.assertUsable();
      return cloneModelMetadata(models);
    });
  }

  refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.fetchModels({ force: true });
  }

  private createMetadataResourceDescriptors(): MetadataResourceDescriptors {
    return {
      runtimeConfig: {
        queryOptions: () => ({
          queryKey: RUNTIME_CONFIG_QUERY_KEY,
          queryFn: async (): Promise<RuntimeConfigSnapshot> =>
            this.runWithClient(async (client) =>
              runtimeConfigSnapshotFromAppServerConfig(await readEffectiveConfig(client, this.context.vaultPath)),
            ),
        }),
        project: (result) => ({
          id: "runtimeConfig",
          value: result.data,
        }),
        snapshot: cloneRuntimeConfigSnapshot,
      },
      models: {
        queryOptions: () => ({
          queryKey: MODELS_QUERY_KEY,
          queryFn: async (): Promise<readonly ModelMetadata[]> => {
            try {
              return cloneModelMetadata(
                await this.runWithClient((client) => listModelMetadata(client), {
                  serverRequests: { kind: "reject", message: "Codex model list refresh does not handle server requests." },
                }),
              );
            } catch (error) {
              throw new MetadataResourceQueryError(diagnosticProbeError("models", error, Date.now()));
            }
          },
          staleTime: MODELS_STALE_TIME_MS,
        }),
        project: (result) => ({
          id: "models",
          value: result.data,
          probe: this.modelsProbe(),
        }),
        snapshot: cloneModelMetadata,
      },
      skills: {
        queryOptions: () => ({
          queryKey: SKILLS_QUERY_KEY,
          queryFn: async () =>
            this.runWithClient(async (client) => successfulMetadataResource(await readSkillMetadataProbe(client, this.context.vaultPath))),
        }),
        project: (result) => ({
          id: "skills",
          value: result.data?.value,
          probe: this.metadataResourceState("skills").probe,
        }),
        snapshot: (data) => data.value.map((skill) => ({ ...skill })),
      },
      permissionProfiles: {
        queryOptions: () => ({
          queryKey: PERMISSION_PROFILES_QUERY_KEY,
          queryFn: async () =>
            this.runWithClient(async (client) =>
              successfulMetadataResource(await readPermissionProfileMetadataProbe(client, this.context.vaultPath)),
            ),
        }),
        project: (result) => ({
          id: "permissionProfiles",
          value: result.data?.value,
          probe: this.metadataResourceState("permissionProfiles").probe,
        }),
        snapshot: (data) => data.value.map((profile) => ({ ...profile })),
      },
      rateLimits: {
        queryOptions: () => ({
          queryKey: RATE_LIMITS_QUERY_KEY,
          queryFn: async () => this.runWithClient(async (client) => successfulMetadataResource(await readRateLimitMetadataProbe(client))),
        }),
        project: (result) => ({
          id: "rateLimits",
          value: result.data?.value,
          probe: this.metadataResourceState("rateLimits").probe,
        }),
        snapshot: (data) => (data.value ? cloneRateLimitSnapshot(data.value) : data.value),
      },
    };
  }

  private metadataDescriptor<Id extends SharedServerMetadataResourceId>(id: Id): MetadataResourceDescriptors[Id] {
    return this.metadataDescriptors[id];
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
        const page = await this.runWithClient(async (client) => {
          if (pageParam !== null) {
            return readThreadPage(client, this.context.vaultPath, {
              cursor: pageParam,
              archived: false,
              isPinned: false,
            });
          }
          const [pinnedThreads, unpinnedPage] = await Promise.all([
            listThreads(client, this.context.vaultPath, { archived: false, isPinned: true, signal }),
            readThreadPage(client, this.context.vaultPath, { archived: false, isPinned: false }),
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
        this.runWithClient((client) => listThreads(client, this.context.vaultPath, { archived: true, signal })).then(cloneThreads),
      staleTime: Number.POSITIVE_INFINITY,
    };
  }

  private async fetchRuntimeConfig(): Promise<void> {
    await this.fetchMetadataResource("runtimeConfig");
  }

  private async fetchMetadataResource<Id extends SharedServerMetadataResourceId>(id: Id): Promise<MetadataQueryData[Id]> {
    const data = await this.client.fetchQuery(this.metadataDescriptor(id).queryOptions());
    this.assertUsable();
    return data;
  }

  private metadataResourceState(resource: "skills"): { value: readonly SkillMetadata[] | null; probe: DiagnosticProbeResult };
  private metadataResourceState(resource: "permissionProfiles"): {
    value: readonly RuntimePermissionProfileSummary[] | null;
    probe: DiagnosticProbeResult;
  };
  private metadataResourceState(resource: "rateLimits"): { value: RateLimitSnapshot | null; probe: DiagnosticProbeResult };
  private metadataResourceState(resource: MetadataResourceKind): { value: MetadataResourceValue; probe: DiagnosticProbeResult } {
    const key = this.metadataDescriptor(resource).queryOptions().queryKey;
    const state = this.client.getQueryState<MetadataResourceSnapshot<MetadataResourceValue>>(key);
    const failedProbe = diagnosticProbeFromError(state?.error);
    return {
      value: state?.data?.value ?? null,
      probe: failedProbe ?? state?.data?.probe ?? createServerDiagnostics().probes[resource],
    };
  }

  private modelsProbe(): DiagnosticProbeResult {
    const state = this.client.getQueryState<readonly ModelMetadata[]>(this.metadataDescriptor("models").queryOptions().queryKey);
    return (
      diagnosticProbeFromError(state?.error) ??
      (state?.data
        ? diagnosticProbeOk("models", `${String(state.data.length)} models`, state.dataUpdatedAt)
        : createServerDiagnostics().probes.models)
    );
  }

  private observeQueryResult<TQuery, TValue>(
    queryOptions: AppServerQueryOptions<TQuery>,
    project: (value: TQuery) => TValue,
    listener: ObservedResultListener<TValue>,
    options: { emitCurrent?: boolean },
  ): () => void {
    const observer = new QueryObserver<TQuery>(this.client, {
      ...queryOptions,
      enabled: false,
    });
    const emit = (result: QueryObserverResult<TQuery>): void => {
      if (!this.disposed) listener(this.projectObservedResult(result, project));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return this.trackObserver(() => {
      unsubscribe();
      observer.destroy();
    });
  }

  private observeMetadataQueryResource<TQuery, Resource extends SharedServerMetadataResource>(
    queryOptions: AppServerQueryOptions<TQuery>,
    project: (result: QueryObserverResult<TQuery>) => Resource,
    listener: (resource: Resource) => void,
    options: { emitCurrent?: boolean },
  ): () => void {
    const observer = new QueryObserver<TQuery>(this.client, {
      ...queryOptions,
      enabled: false,
    });
    const emit = (result: QueryObserverResult<TQuery>, includeFetching = false): void => {
      if (this.disposed || (result.isFetching && !includeFetching)) return;
      listener(cloneSharedServerMetadataResource(project(result)) as Resource);
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult(), true);
    return this.trackObserver(() => {
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

  private runWithClient<T>(operation: (client: AppServerClient) => Promise<T>, options: AppServerClientAccessOptions = {}): Promise<T> {
    this.assertUsable();
    return this.clientAccess.withClient(operation, options);
  }

  private async readThroughQueryCancellation<T>(read: () => Promise<T>, fallback?: () => T | null): Promise<T> {
    for (;;) {
      try {
        const value = await read();
        this.assertUsable();
        return value;
      } catch (error) {
        if (!(error instanceof CancelledError)) throw error;
        this.assertUsable();
        const fallbackValue = fallback?.();
        if (fallbackValue != null) return fallbackValue;
      }
    }
  }

  private async readFreshThroughQueryCancellation<T>(queryKey: readonly unknown[], read: () => Promise<T>): Promise<T> {
    for (;;) {
      const value = await this.readThroughQueryCancellation(read);
      this.assertUsable();
      if (!this.client.getQueryState(queryKey)?.isInvalidated) return value;
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new StaleExecutionRuntimeError();
  }

  private runWhileActive<T>(operation: () => Promise<T>): Promise<T> {
    this.assertUsable();
    return (async () => {
      try {
        const result = await operation();
        this.assertUsable();
        return result;
      } catch (error) {
        if (this.disposed) throw new StaleExecutionRuntimeError();
        throw error;
      }
    })();
  }

  private trackObserver(unsubscribe: () => void): () => void {
    let subscribed = true;
    const trackedUnsubscribe = (): void => {
      if (!subscribed) return;
      subscribed = false;
      this.observerUnsubscribes.delete(trackedUnsubscribe);
      unsubscribe();
    };
    this.observerUnsubscribes.add(trackedUnsubscribe);
    return trackedUnsubscribe;
  }
}

class MetadataResourceQueryError extends Error {
  constructor(readonly probe: DiagnosticProbeResult) {
    super(probe.message ?? `Codex app-server ${probe.id} query failed.`);
    this.name = "MetadataResourceQueryError";
  }
}

function successfulMetadataResource<T>(result: MetadataResourceSnapshot<T>): MetadataResourceSnapshot<T> {
  if (result.probe.status !== "ok") throw new MetadataResourceQueryError(result.probe);
  return result;
}

function diagnosticProbeFromError(error: unknown): DiagnosticProbeResult | null {
  return error instanceof MetadataResourceQueryError ? error.probe : null;
}

function createAppServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
