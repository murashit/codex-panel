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
  appServerQueryContextIdentityKey,
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
  private readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;
  private readonly activeThreadCursors = new Map<string, string | null>();
  private readonly activeThreadRevisions = new Map<string, number>();
  private readonly metadataRefreshes = new Map<string, number>();
  private readonly metadataProjectionListeners = new Map<string, Set<() => void>>();
  private readonly metadataResourceFetches = new Map<string, Set<Promise<void>>>();
  private readonly metadataNotificationRefreshes = new Map<string, MetadataNotificationRefresh>();
  private generation = 0;

  constructor(options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
  }

  clear(): void {
    this.activeThreadCursors.clear();
    this.activeThreadRevisions.clear();
    this.metadataRefreshes.clear();
    this.metadataProjectionListeners.clear();
    this.metadataResourceFetches.clear();
    this.metadataNotificationRefreshes.clear();
    this.generation += 1;
    this.client.clear();
  }

  release(context: AppServerQueryContext): void {
    this.generation += 1;
    const identityKey = appServerQueryContextIdentityKey(context);
    const activeThreadsKey = JSON.stringify(activeThreadsQueryKey(context));
    this.activeThreadCursors.delete(activeThreadsKey);
    this.activeThreadRevisions.delete(activeThreadsKey);
    this.metadataRefreshes.delete(identityKey);
    this.metadataProjectionListeners.delete(identityKey);
    for (const resource of ["skills", "permissionProfiles", "rateLimits"] as const) {
      const resourceKey = this.metadataResourceKey(context, resource);
      this.metadataResourceFetches.delete(resourceKey);
      this.metadataNotificationRefreshes.delete(resourceKey);
    }
    this.client.removeQueries({ queryKey: ["app-server", context.generation, context.codexPath, context.vaultPath] });
  }

  activeThreadsSnapshot(context: AppServerQueryContext): readonly Thread[] | null {
    return this.threadListSnapshot(context, "active");
  }

  archivedThreadsSnapshot(context: AppServerQueryContext): readonly Thread[] | null {
    return this.threadListSnapshot(context, "archived");
  }

  observeActiveThreadsResult(
    context: AppServerQueryContext,
    listener: ObservedResultListener<readonly Thread[]>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQueryResult(this.threadListQueryOptions(context, "active"), cloneThreads, listener, options);
  }

  observeArchivedThreadsResult(
    context: AppServerQueryContext,
    listener: ObservedResultListener<readonly Thread[]>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQueryResult(this.threadListQueryOptions(context, "archived"), cloneThreads, listener, options);
  }

  async fetchActiveThreads(context: AppServerQueryContext, options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    return this.fetchThreadList(context, "active", options);
  }

  async fetchArchivedThreads(context: AppServerQueryContext, options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    return this.fetchThreadList(context, "archived", options);
  }

  async refreshActiveThreads(context: AppServerQueryContext): Promise<readonly Thread[]> {
    return this.fetchActiveThreads(context, { force: true });
  }

  async fetchAllActiveThreads(context: AppServerQueryContext): Promise<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    if (!appServerQueryContextIsComplete(refreshContext)) return [];
    const cursorKey = this.activeThreadCursorKey(refreshContext);
    const snapshot = this.activeThreadsSnapshot(refreshContext);
    if (snapshot && this.activeThreadCursors.has(cursorKey) && !this.activeThreadCursors.get(cursorKey)) return snapshot;
    for (let attempt = 0; attempt < FULL_ACTIVE_THREAD_FETCH_ATTEMPTS; attempt += 1) {
      const revision = this.activeThreadRevision(refreshContext);
      const threads = await this.runWithClient(refreshContext, (client) => listThreads(client, refreshContext.vaultPath));
      if (this.activeThreadRevision(refreshContext) !== revision) continue;
      this.storeThreadList(refreshContext, "active", threads);
      this.rememberActiveThreadCursor(refreshContext, null);
      return cloneThreads(threads);
    }
    throw new Error("Active thread inventory changed while it was being fetched.");
  }

  hasMoreActiveThreads(context: AppServerQueryContext): boolean {
    if (!appServerQueryContextIsComplete(context)) return false;
    return Boolean(this.activeThreadCursors.get(this.activeThreadCursorKey(context)));
  }

  async loadMoreActiveThreads(context: AppServerQueryContext): Promise<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    if (!appServerQueryContextIsComplete(refreshContext)) return [];
    const current = this.activeThreadsSnapshot(refreshContext) ?? (await this.fetchActiveThreads(refreshContext));
    const cursor = this.activeThreadCursors.get(this.activeThreadCursorKey(refreshContext)) ?? null;
    if (!cursor) return current;
    const revision = this.activeThreadRevision(refreshContext);
    const page = await this.runWithClient(refreshContext, (client) =>
      readThreadPage(client, refreshContext.vaultPath, { cursor, archived: false }),
    );
    if (page.nextCursor === cursor) throw new Error("Codex app-server returned a repeated thread list cursor.");
    if (this.activeThreadRevision(refreshContext) !== revision) return this.activeThreadsSnapshot(refreshContext) ?? current;
    const latest = this.activeThreadsSnapshot(refreshContext) ?? current;
    const existingIds = new Set(latest.map((thread) => thread.id));
    const threads = [...latest, ...page.threads.filter((thread) => !existingIds.has(thread.id))];
    this.storeThreadList(refreshContext, "active", threads);
    this.rememberActiveThreadCursor(refreshContext, page.nextCursor);
    return cloneThreads(threads);
  }

  async refreshArchivedThreads(context: AppServerQueryContext): Promise<readonly Thread[]> {
    return this.fetchArchivedThreads(context, { force: true });
  }

  private threadListSnapshot(context: AppServerQueryContext, kind: ThreadListKind): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const threads = this.client.getQueryData<readonly Thread[]>(this.threadListQueryKey(context, kind));
    return threads ? cloneThreads(threads) : null;
  }

  private async fetchThreadList(
    context: AppServerQueryContext,
    kind: ThreadListKind,
    options: { force?: boolean } = {},
  ): Promise<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    if (!appServerQueryContextIsComplete(refreshContext)) {
      return [];
    }
    const key = this.threadListQueryKey(refreshContext, kind);
    if (options.force) await this.client.invalidateQueries({ queryKey: key });
    const threads = await this.client.fetchQuery(this.threadListQueryOptions(refreshContext, kind));
    return cloneThreads(threads);
  }

  private storeThreadList(context: AppServerQueryContext, kind: ThreadListKind, threads: readonly Thread[]): void {
    if (!appServerQueryContextIsComplete(context)) return;
    this.client.setQueryData(this.threadListQueryKey(context, kind), cloneThreads(threads));
    if (kind === "active") this.bumpActiveThreadRevision(context);
  }

  appServerMetadataSnapshot(context: AppServerQueryContext): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const runtimeConfig = this.client.getQueryData<RuntimeConfigSnapshot>(appServerRuntimeConfigQueryKey(context));
    if (!runtimeConfig) return null;
    const skills = this.metadataResourceState(context, "skills");
    const permissionProfiles = this.metadataResourceState(context, "permissionProfiles");
    const rateLimits = this.metadataResourceState(context, "rateLimits");
    const diagnostics = [this.modelsProbe(context), skills.probe, permissionProfiles.probe, rateLimits.probe].reduce(
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
    context: AppServerQueryContext,
    listener: ObservedResultListener<SharedServerMetadata>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    const generation = this.generation;
    const observers = [
      new QueryObserver(this.client, { ...this.runtimeConfigQueryOptions(refreshContext), enabled: false }),
      new QueryObserver(this.client, { ...this.skillsQueryOptions(refreshContext), enabled: false }),
      new QueryObserver(this.client, { ...this.permissionProfilesQueryOptions(refreshContext), enabled: false }),
      new QueryObserver(this.client, { ...this.rateLimitsQueryOptions(refreshContext), enabled: false }),
      new QueryObserver(this.client, { ...this.modelsQueryOptions(refreshContext), enabled: false }),
    ];
    let queued = false;
    let disposed = false;
    const emit = (): void => {
      queued = false;
      if (disposed || generation !== this.generation) return;
      const metadata = this.appServerMetadataSnapshot(refreshContext);
      const runtimeState = this.client.getQueryState(appServerRuntimeConfigQueryKey(refreshContext));
      listener({
        value: metadata,
        error: runtimeState?.error instanceof Error ? runtimeState.error : null,
        isFetching: observers.some((observer) => observer.getCurrentResult().isFetching),
      });
    };
    const schedule = (): void => {
      if (disposed || generation !== this.generation) return;
      if ((this.metadataRefreshes.get(appServerQueryContextIdentityKey(refreshContext)) ?? 0) > 0 || queued) return;
      queued = true;
      queueMicrotask(emit);
    };
    const contextKey = appServerQueryContextIdentityKey(refreshContext);
    const projectionListeners = this.metadataProjectionListeners.get(contextKey) ?? new Set<() => void>();
    projectionListeners.add(schedule);
    this.metadataProjectionListeners.set(contextKey, projectionListeners);
    const unsubscribers = observers.map((observer) => observer.subscribe(schedule));
    if (options.emitCurrent ?? true) emit();
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      projectionListeners.delete(schedule);
      if (projectionListeners.size === 0) this.metadataProjectionListeners.delete(contextKey);
    };
  }

  async refreshAppServerMetadata(context: AppServerQueryContext): Promise<SharedServerMetadata | null> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    if (!appServerQueryContextIsComplete(refreshContext)) return null;
    return this.runMetadataRefresh(refreshContext, async () => {
      const runtimeResult = this.fetchRuntimeConfig(refreshContext, true).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const [, runtime] = await Promise.all([
        Promise.allSettled([
          this.fetchMetadataResource(refreshContext, "skills", true),
          this.fetchMetadataResource(refreshContext, "permissionProfiles", true),
          this.fetchMetadataResource(refreshContext, "rateLimits", true),
          this.fetchModels(refreshContext, { force: true }),
        ]),
        runtimeResult,
      ]);
      if (!runtime.ok) throw runtime.error;
      return this.appServerMetadataSnapshot(refreshContext);
    });
  }

  async refreshSkills(context: AppServerQueryContext): Promise<SharedServerMetadata | null> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    if (!appServerQueryContextIsComplete(refreshContext)) return null;
    return this.runMetadataRefresh(refreshContext, async () => {
      const current = await this.refreshMetadataResourceNotification(refreshContext, "skills");
      return current ? this.appServerMetadataSnapshot(refreshContext) : null;
    });
  }

  async refreshRateLimits(context: AppServerQueryContext): Promise<SharedServerMetadata | null> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    if (!appServerQueryContextIsComplete(refreshContext)) return null;
    return this.runMetadataRefresh(refreshContext, async () => {
      const current = await this.refreshMetadataResourceNotification(refreshContext, "rateLimits");
      return current ? this.appServerMetadataSnapshot(refreshContext) : null;
    });
  }

  modelsSnapshot(context: AppServerQueryContext): readonly ModelMetadata[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const models = this.client.getQueryData<readonly ModelMetadata[]>(appServerModelsQueryKey(context));
    return models ? cloneModelMetadata(models) : null;
  }

  observeModelsResult(
    context: AppServerQueryContext,
    listener: ObservedResultListener<readonly ModelMetadata[]>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQueryResult(this.modelsQueryOptions(context), cloneModelMetadata, listener, options);
  }

  async fetchModels(context: AppServerQueryContext, options: { force?: boolean } = {}): Promise<readonly ModelMetadata[]> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    if (!appServerQueryContextIsComplete(refreshContext)) {
      return [];
    }
    const key = appServerModelsQueryKey(refreshContext);
    if (options.force) await this.client.invalidateQueries({ queryKey: key });
    const models = await this.client.fetchQuery(this.modelsQueryOptions(refreshContext));
    return cloneModelMetadata(models);
  }

  async refreshModels(context: AppServerQueryContext): Promise<readonly ModelMetadata[]> {
    return this.fetchModels(context, { force: true });
  }

  private threadListQueryOptions(context: AppServerQueryContext, kind: ThreadListKind): AppServerQueryOptions<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    return {
      queryKey: this.threadListQueryKey(refreshContext, kind),
      queryFn: async (): Promise<readonly Thread[]> => {
        if (kind === "active") {
          const revision = this.activeThreadRevision(refreshContext);
          const page = await this.runWithClient(refreshContext, (client) =>
            readThreadPage(client, refreshContext.vaultPath, { archived: false }),
          );
          if (this.activeThreadRevision(refreshContext) !== revision) return this.activeThreadsSnapshot(refreshContext) ?? [];
          this.rememberActiveThreadCursor(refreshContext, page.nextCursor);
          return cloneThreads(page.threads);
        }
        return cloneThreads(
          await this.runWithClient(refreshContext, (client) => listThreads(client, refreshContext.vaultPath, { archived: true })),
        );
      },
      staleTime: THREAD_LIST_STALE_TIME_MS,
    };
  }

  private threadListQueryKey(
    context: AppServerQueryContext,
    kind: ThreadListKind,
  ): ReturnType<typeof activeThreadsQueryKey> | ReturnType<typeof archivedThreadsQueryKey> {
    return kind === "archived" ? archivedThreadsQueryKey(context) : activeThreadsQueryKey(context);
  }

  private runtimeConfigQueryOptions(context: AppServerQueryContext): AppServerQueryOptions<RuntimeConfigSnapshot> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    return {
      queryKey: appServerRuntimeConfigQueryKey(refreshContext),
      queryFn: async (): Promise<RuntimeConfigSnapshot> =>
        this.runWithClient(refreshContext, async (client) =>
          runtimeConfigSnapshotFromAppServerConfig(await readEffectiveConfig(client, refreshContext.vaultPath)),
        ),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private skillsQueryOptions(
    context: AppServerQueryContext,
    forceReload = false,
  ): AppServerQueryOptions<MetadataResourceSnapshot<readonly SkillMetadata[]>> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    return {
      queryKey: appServerSkillsQueryKey(refreshContext),
      queryFn: async () =>
        this.runWithClient(refreshContext, async (client) =>
          successfulMetadataResource(await readSkillMetadataProbe(client, refreshContext.vaultPath, forceReload)),
        ),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private permissionProfilesQueryOptions(
    context: AppServerQueryContext,
  ): AppServerQueryOptions<MetadataResourceSnapshot<readonly RuntimePermissionProfileSummary[]>> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    return {
      queryKey: appServerPermissionProfilesQueryKey(refreshContext),
      queryFn: async () =>
        this.runWithClient(refreshContext, async (client) =>
          successfulMetadataResource(await readPermissionProfileMetadataProbe(client, refreshContext.vaultPath)),
        ),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private rateLimitsQueryOptions(
    context: AppServerQueryContext,
  ): AppServerQueryOptions<MetadataResourceSnapshot<RateLimitSnapshot | null>> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    return {
      queryKey: appServerRateLimitsQueryKey(refreshContext),
      queryFn: async () =>
        this.runWithClient(refreshContext, async (client) => successfulMetadataResource(await readRateLimitMetadataProbe(client))),
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private async fetchRuntimeConfig(context: AppServerQueryContext, force: boolean): Promise<RuntimeConfigSnapshot> {
    const key = appServerRuntimeConfigQueryKey(context);
    if (force) await this.client.invalidateQueries({ queryKey: key });
    return cloneRuntimeConfigSnapshot(await this.client.fetchQuery(this.runtimeConfigQueryOptions(context)));
  }

  private fetchMetadataResource(
    context: AppServerQueryContext,
    resource: MetadataResourceKind,
    force: boolean,
    reloadSkills = false,
  ): Promise<void> {
    const key = this.metadataResourceKey(context, resource);
    const refresh = (async (): Promise<void> => {
      if (resource === "skills") {
        const options = this.skillsQueryOptions(context, reloadSkills);
        if (force) await this.client.invalidateQueries({ queryKey: options.queryKey });
        await this.client.fetchQuery(options);
        return;
      }
      if (resource === "permissionProfiles") {
        const options = this.permissionProfilesQueryOptions(context);
        if (force) await this.client.invalidateQueries({ queryKey: options.queryKey });
        await this.client.fetchQuery(options);
        return;
      }
      const options = this.rateLimitsQueryOptions(context);
      if (force) await this.client.invalidateQueries({ queryKey: options.queryKey });
      await this.client.fetchQuery(options);
    })();
    const active = this.metadataResourceFetches.get(key) ?? new Set<Promise<void>>();
    active.add(refresh);
    this.metadataResourceFetches.set(key, active);
    const cleanup = (): void => {
      active.delete(refresh);
      if (active.size === 0 && this.metadataResourceFetches.get(key) === active) this.metadataResourceFetches.delete(key);
    };
    void refresh.then(cleanup, cleanup);
    return refresh;
  }

  private refreshMetadataResourceNotification(
    context: AppServerQueryContext,
    resource: MetadataNotificationResourceKind,
  ): Promise<boolean> {
    const key = this.metadataResourceKey(context, resource);
    const generation = this.generation;
    const current = this.metadataNotificationRefreshes.get(key);
    if (current?.generation === generation) {
      current.dirty = true;
      return current.promise.then(() => generation === this.generation);
    }

    const activeFetches = [...(this.metadataResourceFetches.get(key) ?? [])];
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
        await this.fetchMetadataResource(context, resource, true, resource === "skills").catch(() => undefined);
        if (generation !== this.generation) return;
        if (!metadataNotificationRefreshIsDirty(refresh)) return;
      }
    })();
    this.metadataNotificationRefreshes.set(key, refresh);
    const cleanup = (): void => {
      if (this.metadataNotificationRefreshes.get(key) === refresh) this.metadataNotificationRefreshes.delete(key);
    };
    void refresh.promise.then(cleanup, cleanup);
    return refresh.promise.then(() => generation === this.generation);
  }

  private metadataResourceKey(context: AppServerQueryContext, resource: MetadataResourceKind): string {
    return `${appServerQueryContextIdentityKey(context)}\u0000${resource}`;
  }

  private metadataResourceState(
    context: AppServerQueryContext,
    resource: "skills",
  ): { value: readonly SkillMetadata[] | null; probe: DiagnosticProbeResult };
  private metadataResourceState(
    context: AppServerQueryContext,
    resource: "permissionProfiles",
  ): { value: readonly RuntimePermissionProfileSummary[] | null; probe: DiagnosticProbeResult };
  private metadataResourceState(
    context: AppServerQueryContext,
    resource: "rateLimits",
  ): { value: RateLimitSnapshot | null; probe: DiagnosticProbeResult };
  private metadataResourceState(
    context: AppServerQueryContext,
    resource: MetadataResourceKind,
  ): { value: MetadataResourceValue; probe: DiagnosticProbeResult } {
    const key =
      resource === "skills"
        ? appServerSkillsQueryKey(context)
        : resource === "permissionProfiles"
          ? appServerPermissionProfilesQueryKey(context)
          : appServerRateLimitsQueryKey(context);
    const state = this.client.getQueryState<MetadataResourceSnapshot<MetadataResourceValue>>(key);
    const failedProbe = diagnosticProbeFromError(state?.error);
    return {
      value: state?.data?.value ?? null,
      probe: failedProbe ?? state?.data?.probe ?? createServerDiagnostics().probes[resource],
    };
  }

  private modelsProbe(context: AppServerQueryContext): DiagnosticProbeResult {
    const state = this.client.getQueryState<readonly ModelMetadata[]>(appServerModelsQueryKey(context));
    return (
      diagnosticProbeFromError(state?.error) ??
      (state?.data
        ? diagnosticProbeOk("models", `${String(state.data.length)} models`, state.dataUpdatedAt)
        : createServerDiagnostics().probes.models)
    );
  }

  private async runMetadataRefresh<T>(context: AppServerQueryContext, operation: () => Promise<T>): Promise<T> {
    const key = appServerQueryContextIdentityKey(context);
    this.metadataRefreshes.set(key, (this.metadataRefreshes.get(key) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      const remaining = (this.metadataRefreshes.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.metadataRefreshes.set(key, remaining);
      } else {
        this.metadataRefreshes.delete(key);
        for (const listener of this.metadataProjectionListeners.get(key) ?? []) listener();
      }
    }
  }

  private modelsQueryOptions(context: AppServerQueryContext): AppServerQueryOptions<readonly ModelMetadata[]> {
    const refreshContext = cloneAppServerQueryContextIdentity(context);
    return {
      queryKey: appServerModelsQueryKey(refreshContext),
      queryFn: async (): Promise<readonly ModelMetadata[]> => {
        try {
          return cloneModelMetadata(
            await this.runWithClient(refreshContext, (client) => listModelMetadata(client), {
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

  private runWithClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options: AppServerClientAccessOptions = {},
  ): Promise<T> {
    if (!this.clientRunner) {
      throw new Error("Codex app-server query client runner is not configured.");
    }
    return this.clientRunner.runWithClient(context, operation, options);
  }

  private activeThreadCursorKey(context: AppServerQueryContext): string {
    return JSON.stringify(activeThreadsQueryKey(context));
  }

  private rememberActiveThreadCursor(context: AppServerQueryContext, cursor: string | null): void {
    const key = this.activeThreadCursorKey(context);
    this.activeThreadCursors.delete(key);
    this.activeThreadCursors.set(key, cursor);
    this.bumpActiveThreadRevision(context);
    while (this.activeThreadCursors.size > 8) {
      for (const oldestKey of this.activeThreadCursors.keys()) {
        this.activeThreadCursors.delete(oldestKey);
        this.activeThreadRevisions.delete(oldestKey);
        break;
      }
    }
  }

  private activeThreadRevision(context: AppServerQueryContext): number {
    return this.activeThreadRevisions.get(this.activeThreadCursorKey(context)) ?? 0;
  }

  private bumpActiveThreadRevision(context: AppServerQueryContext): void {
    const key = this.activeThreadCursorKey(context);
    this.activeThreadRevisions.set(key, this.activeThreadRevision(context) + 1);
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
