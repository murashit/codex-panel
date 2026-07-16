import { QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/query-core";
import type { ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import { cloneRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../domain/runtime/permissions";
import {
  createServerDiagnostics,
  type DiagnosticProbeResult,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
} from "../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import type { AppServerClient } from "../connection/client";
import type { AppServerClientAccessOptions } from "../connection/client-access";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { listModelMetadata } from "../services/catalog";
import { readEffectiveConfig } from "../services/runtime-metadata";
import { listThreads, readThreadPage } from "../services/threads";
import {
  type AppServerQueryContextIdentity as AppServerQueryContext,
  activeThreadsQueryKey,
  appServerModelsQueryKey,
  appServerPermissionProfilesQueryKey,
  appServerQueryContextIsComplete,
  appServerRateLimitsQueryKey,
  appServerRuntimeConfigQueryKey,
  appServerSkillsQueryKey,
  archivedThreadsQueryKey,
  cloneAppServerQueryContextIdentity,
} from "./keys";
import { readPermissionProfileMetadataProbe, readRateLimitMetadataProbe, readSkillMetadataProbe } from "./metadata-probes";
import type { ObservedResult, ObservedResultListener } from "./observed-result";
import { cloneModelMetadata, cloneSharedServerMetadata, cloneThreads } from "./snapshots";

const THREAD_LIST_STALE_TIME_MS = 10_000;
const APP_SERVER_METADATA_STALE_TIME_MS = 10_000;
const MODELS_STALE_TIME_MS = 60_000;
const APP_SERVER_QUERY_GC_TIME_MS = 5 * 60_000;
const FULL_ACTIVE_THREAD_FETCH_ATTEMPTS = 2;

export interface AppServerQueryClientRunner {
  runWithClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options?: AppServerClientAccessOptions,
  ): Promise<T>;
}

interface AppServerQueryOptions<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: () => Promise<T>;
  readonly staleTime: number;
}

type ThreadListKind = "active" | "archived";
interface MetadataResourceSnapshot<T> {
  readonly value: T;
  readonly probe: DiagnosticProbeResult;
}

type MetadataResourceKind = "skills" | "permissionProfiles" | "rateLimits";
type MetadataNotificationResourceKind = "skills" | "rateLimits";
type MetadataResourceValue = readonly SkillMetadata[] | readonly RuntimePermissionProfileSummary[] | RateLimitSnapshot | null;

interface MetadataNotificationRefresh {
  dirty: boolean;
  readonly generation: number;
  promise: Promise<void>;
}

export class AppServerQueryCache {
  private readonly context: AppServerQueryContext;
  private readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;
  private activeThreadCursorKnown = false;
  private activeThreadCursor: string | null = null;
  private activeThreadRevision = 0;
  private metadataRefreshCount = 0;
  private readonly metadataProjectionListeners = new Set<() => void>();
  private readonly metadataResourceFetches = new Map<MetadataResourceKind, Set<Promise<void>>>();
  private readonly metadataNotificationRefreshes = new Map<MetadataNotificationResourceKind, MetadataNotificationRefresh>();
  private generation = 0;
  private disposed = false;

  constructor(context: AppServerQueryContext, options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.context = cloneAppServerQueryContextIdentity(context);
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.activeThreadCursorKnown = false;
    this.activeThreadCursor = null;
    this.activeThreadRevision = 0;
    this.metadataRefreshCount = 0;
    this.metadataProjectionListeners.clear();
    this.metadataResourceFetches.clear();
    this.metadataNotificationRefreshes.clear();
    this.client.clear();
  }

  activeThreadsSnapshot(): readonly Thread[] | null {
    if (this.disposed) return null;
    return this.threadListSnapshot("active");
  }

  archivedThreadsSnapshot(): readonly Thread[] | null {
    if (this.disposed) return null;
    return this.threadListSnapshot("archived");
  }

  observeActiveThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.assertUsable();
    return this.observeQueryResult(this.threadListQueryOptions("active"), cloneThreads, listener, options);
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.assertUsable();
    return this.observeQueryResult(this.threadListQueryOptions("archived"), cloneThreads, listener, options);
  }

  async fetchActiveThreads(options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    this.assertUsable();
    return this.fetchThreadList("active", options);
  }

  async fetchArchivedThreads(options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    this.assertUsable();
    return this.fetchThreadList("archived", options);
  }

  async refreshActiveThreads(): Promise<readonly Thread[]> {
    return this.fetchActiveThreads({ force: true });
  }

  async fetchAllActiveThreads(): Promise<readonly Thread[]> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const snapshot = this.activeThreadsSnapshot();
    if (snapshot && this.activeThreadCursorKnown && !this.activeThreadCursor) return snapshot;
    for (let attempt = 0; attempt < FULL_ACTIVE_THREAD_FETCH_ATTEMPTS; attempt += 1) {
      const revision = this.activeThreadRevision;
      const threads = await this.runWithClient((client) => listThreads(client, this.context.vaultPath));
      if (this.activeThreadRevision !== revision) continue;
      this.storeThreadList("active", threads);
      this.rememberActiveThreadCursor(null);
      return cloneThreads(threads);
    }
    throw new Error("Active thread inventory changed while it was being fetched.");
  }

  hasMoreActiveThreads(): boolean {
    if (this.disposed) return false;
    if (!appServerQueryContextIsComplete(this.context)) return false;
    return Boolean(this.activeThreadCursor);
  }

  async loadMoreActiveThreads(): Promise<readonly Thread[]> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const current = this.activeThreadsSnapshot() ?? (await this.fetchActiveThreads());
    const cursor = this.activeThreadCursor;
    if (!cursor) return current;
    const revision = this.activeThreadRevision;
    const page = await this.runWithClient((client) => readThreadPage(client, this.context.vaultPath, { cursor, archived: false }));
    if (page.nextCursor === cursor) throw new Error("Codex app-server returned a repeated thread list cursor.");
    if (this.activeThreadRevision !== revision) return this.activeThreadsSnapshot() ?? current;
    const latest = this.activeThreadsSnapshot() ?? current;
    const existingIds = new Set(latest.map((thread) => thread.id));
    const threads = [...latest, ...page.threads.filter((thread) => !existingIds.has(thread.id))];
    this.storeThreadList("active", threads);
    this.rememberActiveThreadCursor(page.nextCursor);
    return cloneThreads(threads);
  }

  async refreshArchivedThreads(): Promise<readonly Thread[]> {
    return this.fetchArchivedThreads({ force: true });
  }

  private threadListSnapshot(kind: ThreadListKind): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(this.context)) return null;
    const threads = this.client.getQueryData<readonly Thread[]>(this.threadListQueryKey(kind));
    return threads ? cloneThreads(threads) : null;
  }

  private async fetchThreadList(kind: ThreadListKind, options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const key = this.threadListQueryKey(kind);
    if (options.force) {
      await this.client.invalidateQueries({ queryKey: key });
      this.assertUsable();
    }
    const threads = await this.client.fetchQuery(this.threadListQueryOptions(kind));
    this.assertUsable();
    return cloneThreads(threads);
  }

  private storeThreadList(kind: ThreadListKind, threads: readonly Thread[]): void {
    if (!appServerQueryContextIsComplete(this.context)) return;
    this.client.setQueryData(this.threadListQueryKey(kind), cloneThreads(threads));
    if (kind === "active") this.bumpActiveThreadRevision();
  }

  appServerMetadataSnapshot(): SharedServerMetadata | null {
    if (this.disposed) return null;
    if (!appServerQueryContextIsComplete(this.context)) return null;
    const runtimeConfig = this.client.getQueryData<RuntimeConfigSnapshot>(appServerRuntimeConfigQueryKey(this.context));
    if (!runtimeConfig) return null;
    const skills = this.metadataResourceState("skills");
    const permissionProfiles = this.metadataResourceState("permissionProfiles");
    const rateLimits = this.metadataResourceState("rateLimits");
    const diagnostics = [this.modelsProbe(), skills.probe, permissionProfiles.probe, rateLimits.probe].reduce(
      (current, probe) => diagnosticsWithProbe(current, probe),
      createServerDiagnostics(),
    );
    return cloneSharedServerMetadata({
      runtimeConfig,
      availableSkills: skills.value ?? [],
      availablePermissionProfiles: permissionProfiles.value ?? [],
      rateLimit: rateLimits.value ?? null,
      serverDiagnostics: diagnostics,
    });
  }

  observeAppServerMetadataResult(
    listener: ObservedResultListener<SharedServerMetadata>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    this.assertUsable();
    const generation = this.generation;
    const observers = [
      new QueryObserver(this.client, { ...this.runtimeConfigQueryOptions(), enabled: false }),
      new QueryObserver(this.client, { ...this.skillsQueryOptions(), enabled: false }),
      new QueryObserver(this.client, { ...this.permissionProfilesQueryOptions(), enabled: false }),
      new QueryObserver(this.client, { ...this.rateLimitsQueryOptions(), enabled: false }),
      new QueryObserver(this.client, { ...this.modelsQueryOptions(), enabled: false }),
    ];
    let queued = false;
    let disposed = false;
    const emit = (): void => {
      queued = false;
      if (disposed || generation !== this.generation) return;
      const metadata = this.appServerMetadataSnapshot();
      const runtimeState = this.client.getQueryState(appServerRuntimeConfigQueryKey(this.context));
      listener({
        value: metadata,
        error: runtimeState?.error instanceof Error ? runtimeState.error : null,
        isFetching: observers.some((observer) => observer.getCurrentResult().isFetching),
      });
    };
    const schedule = (): void => {
      if (disposed || generation !== this.generation) return;
      if (this.metadataRefreshCount > 0 || queued) return;
      queued = true;
      queueMicrotask(emit);
    };
    this.metadataProjectionListeners.add(schedule);
    const unsubscribers = observers.map((observer) => observer.subscribe(schedule));
    if (options.emitCurrent ?? true) emit();
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      this.metadataProjectionListeners.delete(schedule);
    };
  }

  async refreshAppServerMetadata(): Promise<SharedServerMetadata | null> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return null;
    return this.runMetadataRefresh(async () => {
      const runtimeResult = this.fetchRuntimeConfig(true).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const [, runtime] = await Promise.all([
        Promise.allSettled([
          this.fetchMetadataResource("skills", true),
          this.fetchMetadataResource("permissionProfiles", true),
          this.fetchMetadataResource("rateLimits", true),
          this.fetchModels({ force: true }),
        ]),
        runtimeResult,
      ]);
      this.assertUsable();
      if (!runtime.ok) throw runtime.error;
      return this.appServerMetadataSnapshot();
    });
  }

  async refreshSkills(): Promise<SharedServerMetadata | null> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return null;
    return this.runMetadataRefresh(async () => {
      const current = await this.refreshMetadataResourceNotification("skills");
      this.assertUsable();
      return current ? this.appServerMetadataSnapshot() : null;
    });
  }

  async refreshRateLimits(): Promise<SharedServerMetadata | null> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return null;
    return this.runMetadataRefresh(async () => {
      const current = await this.refreshMetadataResourceNotification("rateLimits");
      this.assertUsable();
      return current ? this.appServerMetadataSnapshot() : null;
    });
  }

  modelsSnapshot(): readonly ModelMetadata[] | null {
    if (this.disposed) return null;
    if (!appServerQueryContextIsComplete(this.context)) return null;
    const models = this.client.getQueryData<readonly ModelMetadata[]>(appServerModelsQueryKey(this.context));
    return models ? cloneModelMetadata(models) : null;
  }

  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.assertUsable();
    return this.observeQueryResult(this.modelsQueryOptions(), cloneModelMetadata, listener, options);
  }

  async fetchModels(options: { force?: boolean } = {}): Promise<readonly ModelMetadata[]> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const key = appServerModelsQueryKey(this.context);
    if (options.force) {
      await this.client.invalidateQueries({ queryKey: key });
      this.assertUsable();
    }
    const models = await this.client.fetchQuery(this.modelsQueryOptions());
    this.assertUsable();
    return cloneModelMetadata(models);
  }

  async refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.fetchModels({ force: true });
  }

  private threadListQueryOptions(kind: ThreadListKind): AppServerQueryOptions<readonly Thread[]> {
    return {
      queryKey: this.threadListQueryKey(kind),
      queryFn: async (): Promise<readonly Thread[]> => {
        if (kind === "active") {
          const revision = this.activeThreadRevision;
          const page = await this.runWithClient((client) => readThreadPage(client, this.context.vaultPath, { archived: false }));
          if (this.activeThreadRevision !== revision) return this.activeThreadsSnapshot() ?? [];
          this.rememberActiveThreadCursor(page.nextCursor);
          return cloneThreads(page.threads);
        }
        return cloneThreads(await this.runWithClient((client) => listThreads(client, this.context.vaultPath, { archived: true })));
      },
      staleTime: THREAD_LIST_STALE_TIME_MS,
    };
  }

  private threadListQueryKey(kind: ThreadListKind): ReturnType<typeof activeThreadsQueryKey> | ReturnType<typeof archivedThreadsQueryKey> {
    return kind === "archived" ? archivedThreadsQueryKey(this.context) : activeThreadsQueryKey(this.context);
  }

  private runtimeConfigQueryOptions(): AppServerQueryOptions<RuntimeConfigSnapshot> {
    return {
      queryKey: appServerRuntimeConfigQueryKey(this.context),
      queryFn: async (): Promise<RuntimeConfigSnapshot> =>
        this.runWithClient(async (client) =>
          runtimeConfigSnapshotFromAppServerConfig(await readEffectiveConfig(client, this.context.vaultPath)),
        ),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private skillsQueryOptions(forceReload = false): AppServerQueryOptions<MetadataResourceSnapshot<readonly SkillMetadata[]>> {
    return {
      queryKey: appServerSkillsQueryKey(this.context),
      queryFn: async () =>
        this.runWithClient(async (client) =>
          successfulMetadataResource(await readSkillMetadataProbe(client, this.context.vaultPath, forceReload)),
        ),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private permissionProfilesQueryOptions(): AppServerQueryOptions<MetadataResourceSnapshot<readonly RuntimePermissionProfileSummary[]>> {
    return {
      queryKey: appServerPermissionProfilesQueryKey(this.context),
      queryFn: async () =>
        this.runWithClient(async (client) =>
          successfulMetadataResource(await readPermissionProfileMetadataProbe(client, this.context.vaultPath)),
        ),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private rateLimitsQueryOptions(): AppServerQueryOptions<MetadataResourceSnapshot<RateLimitSnapshot | null>> {
    return {
      queryKey: appServerRateLimitsQueryKey(this.context),
      queryFn: async () => this.runWithClient(async (client) => successfulMetadataResource(await readRateLimitMetadataProbe(client))),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private async fetchRuntimeConfig(force: boolean): Promise<RuntimeConfigSnapshot> {
    const key = appServerRuntimeConfigQueryKey(this.context);
    if (force) {
      await this.client.invalidateQueries({ queryKey: key });
      this.assertUsable();
    }
    const runtimeConfig = await this.client.fetchQuery(this.runtimeConfigQueryOptions());
    this.assertUsable();
    return cloneRuntimeConfigSnapshot(runtimeConfig);
  }

  private fetchMetadataResource(resource: MetadataResourceKind, force: boolean, reloadSkills = false): Promise<void> {
    const refresh = (async (): Promise<void> => {
      if (resource === "skills") {
        const options = this.skillsQueryOptions(reloadSkills);
        if (force) {
          await this.client.invalidateQueries({ queryKey: options.queryKey });
          this.assertUsable();
        }
        await this.client.fetchQuery(options);
        this.assertUsable();
        return;
      }
      if (resource === "permissionProfiles") {
        const options = this.permissionProfilesQueryOptions();
        if (force) {
          await this.client.invalidateQueries({ queryKey: options.queryKey });
          this.assertUsable();
        }
        await this.client.fetchQuery(options);
        this.assertUsable();
        return;
      }
      const options = this.rateLimitsQueryOptions();
      if (force) {
        await this.client.invalidateQueries({ queryKey: options.queryKey });
        this.assertUsable();
      }
      await this.client.fetchQuery(options);
      this.assertUsable();
    })();
    const active = this.metadataResourceFetches.get(resource) ?? new Set<Promise<void>>();
    active.add(refresh);
    this.metadataResourceFetches.set(resource, active);
    const cleanup = (): void => {
      active.delete(refresh);
      if (active.size === 0 && this.metadataResourceFetches.get(resource) === active) this.metadataResourceFetches.delete(resource);
    };
    void refresh.then(cleanup, cleanup);
    return refresh;
  }

  private refreshMetadataResourceNotification(resource: MetadataNotificationResourceKind): Promise<boolean> {
    const generation = this.generation;
    const current = this.metadataNotificationRefreshes.get(resource);
    if (current?.generation === generation) {
      current.dirty = true;
      return current.promise.then(() => generation === this.generation);
    }

    const activeFetches = [...(this.metadataResourceFetches.get(resource) ?? [])];
    const refresh: MetadataNotificationRefresh = {
      dirty: false,
      generation,
      promise: Promise.resolve(),
    };
    refresh.promise = (async (): Promise<void> => {
      if (activeFetches.length > 0) await Promise.allSettled(activeFetches);
      if (generation !== this.generation) return;
      for (;;) {
        refresh.dirty = false;
        await this.fetchMetadataResource(resource, true, resource === "skills").catch(() => undefined);
        if (generation !== this.generation) return;
        if (!metadataNotificationRefreshIsDirty(refresh)) return;
      }
    })();
    this.metadataNotificationRefreshes.set(resource, refresh);
    const cleanup = (): void => {
      if (this.metadataNotificationRefreshes.get(resource) === refresh) this.metadataNotificationRefreshes.delete(resource);
    };
    void refresh.promise.then(cleanup, cleanup);
    return refresh.promise.then(() => generation === this.generation);
  }

  private metadataResourceState(resource: "skills"): { value: readonly SkillMetadata[] | null; probe: DiagnosticProbeResult };
  private metadataResourceState(resource: "permissionProfiles"): {
    value: readonly RuntimePermissionProfileSummary[] | null;
    probe: DiagnosticProbeResult;
  };
  private metadataResourceState(resource: "rateLimits"): { value: RateLimitSnapshot | null; probe: DiagnosticProbeResult };
  private metadataResourceState(resource: MetadataResourceKind): { value: MetadataResourceValue; probe: DiagnosticProbeResult } {
    const key =
      resource === "skills"
        ? appServerSkillsQueryKey(this.context)
        : resource === "permissionProfiles"
          ? appServerPermissionProfilesQueryKey(this.context)
          : appServerRateLimitsQueryKey(this.context);
    const state = this.client.getQueryState<MetadataResourceSnapshot<MetadataResourceValue>>(key);
    const failedProbe = diagnosticProbeFromError(state?.error);
    return {
      value: state?.data?.value ?? null,
      probe: failedProbe ?? state?.data?.probe ?? createServerDiagnostics().probes[resource],
    };
  }

  private modelsProbe(): DiagnosticProbeResult {
    const state = this.client.getQueryState<readonly ModelMetadata[]>(appServerModelsQueryKey(this.context));
    return (
      diagnosticProbeFromError(state?.error) ??
      (state?.data
        ? diagnosticProbeOk("models", `${String(state.data.length)} models`, state.dataUpdatedAt)
        : createServerDiagnostics().probes.models)
    );
  }

  private async runMetadataRefresh<T>(operation: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    this.metadataRefreshCount += 1;
    try {
      return await operation();
    } finally {
      if (generation === this.generation) {
        this.metadataRefreshCount -= 1;
        if (this.metadataRefreshCount === 0) for (const listener of this.metadataProjectionListeners) listener();
      }
    }
  }

  private modelsQueryOptions(): AppServerQueryOptions<readonly ModelMetadata[]> {
    return {
      queryKey: appServerModelsQueryKey(this.context),
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
    };
  }

  private observeQueryResult<T>(
    queryOptions: AppServerQueryOptions<T>,
    clone: (value: T) => T,
    listener: ObservedResultListener<T>,
    options: { emitCurrent?: boolean },
  ): () => void {
    const observer = new QueryObserver<T>(this.client, {
      ...queryOptions,
      enabled: false,
    });
    const emit = (result: QueryObserverResult<T>): void => {
      listener(this.cloneObservedResult(result, clone));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return unsubscribe;
  }

  private cloneObservedResult<T>(result: QueryObserverResult<T>, clone: (value: T) => T): ObservedResult<T> {
    return {
      value: result.data === undefined ? null : clone(result.data),
      error: result.error instanceof Error ? result.error : null,
      isFetching: result.isFetching,
    };
  }

  private runWithClient<T>(operation: (client: AppServerClient) => Promise<T>, options: AppServerClientAccessOptions = {}): Promise<T> {
    this.assertUsable();
    const generation = this.generation;
    const runner = this.clientRunner;
    if (!runner) throw new Error("Codex app-server query client runner is not configured.");
    return runner.runWithClient(this.context, operation, options).then(
      (result) => {
        if (this.disposed || generation !== this.generation) throw new DisposedAppServerQueryCacheError();
        return result;
      },
      (error: unknown) => {
        if (this.disposed || generation !== this.generation) throw new DisposedAppServerQueryCacheError();
        throw error;
      },
    );
  }

  private assertUsable(): void {
    if (this.disposed) throw new DisposedAppServerQueryCacheError();
  }

  private rememberActiveThreadCursor(cursor: string | null): void {
    this.activeThreadCursorKnown = true;
    this.activeThreadCursor = cursor;
    this.bumpActiveThreadRevision();
  }

  private bumpActiveThreadRevision(): void {
    this.activeThreadRevision += 1;
  }
}

class DisposedAppServerQueryCacheError extends Error {
  constructor() {
    super("Codex app-server query cache was disposed.");
    this.name = "DisposedAppServerQueryCacheError";
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

function metadataNotificationRefreshIsDirty(refresh: MetadataNotificationRefresh): boolean {
  return refresh.dirty;
}

function createAppServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: APP_SERVER_QUERY_GC_TIME_MS,
        retry: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
