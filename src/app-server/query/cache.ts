import { QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/query-core";
import type { ModelMetadata } from "../../domain/catalog/metadata";
import {
  createServerDiagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
  metadataResourceDiagnostics,
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
  type AppServerQueryContext,
  activeThreadsQueryKey,
  appServerMetadataQueryKey,
  appServerModelsQueryKey,
  appServerQueryContextIsComplete,
  archivedThreadsQueryKey,
  cloneAppServerQueryContext,
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
export type MetadataResourceKind = "skills" | "rateLimits";

export class AppServerQueryCache {
  private readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;
  private readonly activeThreadCursors = new Map<string, string | null>();
  private readonly activeThreadRevisions = new Map<string, number>();
  private readonly metadataRevisions = new Map<string, number>();
  private readonly metadataWriteRevisions = new Map<string, number>();

  constructor(options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
  }

  clear(): void {
    this.activeThreadCursors.clear();
    this.activeThreadRevisions.clear();
    this.metadataRevisions.clear();
    this.metadataWriteRevisions.clear();
    this.client.clear();
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
    const refreshContext = cloneAppServerQueryContext(context);
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
    const refreshContext = cloneAppServerQueryContext(context);
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
    const refreshContext = cloneAppServerQueryContext(context);
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
    const metadata = this.client.getQueryData<SharedServerMetadata>(appServerMetadataQueryKey(context));
    return metadata ? cloneSharedServerMetadata(metadata) : null;
  }

  observeAppServerMetadataResult(
    context: AppServerQueryContext,
    listener: ObservedResultListener<SharedServerMetadata>,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQueryResult(this.appServerMetadataQueryOptions(context), cloneSharedServerMetadata, listener, options);
  }

  async refreshAppServerMetadata(
    context: AppServerQueryContext,
    options: { forceSkills?: boolean } = {},
  ): Promise<SharedServerMetadata | null> {
    const refreshContext = cloneAppServerQueryContext(context);
    if (!appServerQueryContextIsComplete(refreshContext)) {
      return null;
    }
    this.beginMetadataResourceRefresh(refreshContext, "skills");
    this.beginMetadataResourceRefresh(refreshContext, "rateLimits");
    const key = appServerMetadataQueryKey(refreshContext);
    await Promise.all([
      this.client.invalidateQueries({ queryKey: key }),
      this.client.invalidateQueries({ queryKey: appServerModelsQueryKey(refreshContext) }),
    ]);
    const metadata = await this.client.fetchQuery(this.appServerMetadataQueryOptions(refreshContext, options));
    return cloneSharedServerMetadata(metadata);
  }

  writeAppServerMetadata(context: AppServerQueryContext, metadata: SharedServerMetadata): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const next = metadataWithLastKnownGood(metadata, this.appServerMetadataSnapshot(context));
    this.client.setQueryData(appServerMetadataQueryKey(context), cloneSharedServerMetadata(next));
    this.bumpMetadataRevision(context);
    this.bumpMetadataWriteRevision(context);
    return cloneSharedServerMetadata(next);
  }

  updateAppServerMetadata(
    context: AppServerQueryContext,
    updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null,
    resource?: MetadataResourceKind,
  ): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const next = updater(this.appServerMetadataSnapshot(context));
    if (!next) return null;
    const merged = metadataWithLastKnownGood(next, this.appServerMetadataSnapshot(context));
    this.client.setQueryData(appServerMetadataQueryKey(context), cloneSharedServerMetadata(merged));
    if (resource) this.beginMetadataResourceRefresh(context, resource);
    else this.bumpMetadataRevision(context);
    this.bumpMetadataWriteRevision(context);
    return cloneSharedServerMetadata(merged);
  }

  beginMetadataResourceRefresh(context: AppServerQueryContext, resource: MetadataResourceKind): number {
    const key = this.metadataResourceRevisionKey(context, resource);
    const revision = (this.metadataRevisions.get(key) ?? 0) + 1;
    this.metadataRevisions.delete(key);
    this.metadataRevisions.set(key, revision);
    while (this.metadataRevisions.size > 16) {
      for (const oldestKey of this.metadataRevisions.keys()) {
        this.metadataRevisions.delete(oldestKey);
        break;
      }
    }
    return revision;
  }

  metadataResourceRefreshIsCurrent(context: AppServerQueryContext, resource: MetadataResourceKind, revision: number): boolean {
    return this.metadataRevisions.get(this.metadataResourceRevisionKey(context, resource)) === revision;
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
    const refreshContext = cloneAppServerQueryContext(context);
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
    const refreshContext = cloneAppServerQueryContext(context);
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

  private appServerMetadataQueryOptions(
    context: AppServerQueryContext,
    options: { forceSkills?: boolean } = {},
  ): AppServerQueryOptions<SharedServerMetadata> {
    const refreshContext = cloneAppServerQueryContext(context);
    return {
      queryKey: appServerMetadataQueryKey(refreshContext),
      queryFn: async (): Promise<SharedServerMetadata> => {
        const previous = this.appServerMetadataSnapshot(refreshContext);
        const revision = this.metadataRevision(refreshContext);
        const metadata = await this.runWithClient(refreshContext, async (client) => {
          const runtimeConfig = runtimeConfigSnapshotFromAppServerConfig(await readEffectiveConfig(client, refreshContext.vaultPath));
          const [modelProbe, skills, permissionProfiles, rateLimit] = await Promise.all([
            this.readModelMetadataProbe(refreshContext, client),
            readSkillMetadataProbe(client, refreshContext.vaultPath, options.forceSkills ?? false),
            readPermissionProfileMetadataProbe(client, refreshContext.vaultPath),
            readRateLimitMetadataProbe(client),
          ]);
          const diagnostics = [modelProbe, skills.probe, permissionProfiles.probe, rateLimit.probe].reduce(
            (current, probe) => diagnosticsWithProbe(current, probe),
            previous?.serverDiagnostics ?? createServerDiagnostics(),
          );
          return metadataWithLastKnownGood(
            {
              runtimeConfig,
              availableSkills: skills.value,
              availablePermissionProfiles: permissionProfiles.value,
              rateLimit: rateLimit.value,
              serverDiagnostics: diagnostics,
            },
            previous,
          );
        });
        return this.metadataRevision(refreshContext) === revision ? metadata : (this.appServerMetadataSnapshot(refreshContext) ?? metadata);
      },
      staleTime: APP_SERVER_METADATA_STALE_TIME_MS,
    };
  }

  private modelsQueryOptions(context: AppServerQueryContext): AppServerQueryOptions<readonly ModelMetadata[]> {
    const refreshContext = cloneAppServerQueryContext(context);
    return {
      queryKey: appServerModelsQueryKey(refreshContext),
      queryFn: async (): Promise<readonly ModelMetadata[]> => {
        return cloneModelMetadata(
          await this.runWithClient(refreshContext, (client) => listModelMetadata(client), {
            serverRequests: { kind: "reject", message: "Codex model list refresh does not handle server requests." },
          }),
        );
      },
      staleTime: MODELS_STALE_TIME_MS,
    };
  }

  private async readModelMetadataProbe(
    context: AppServerQueryContext,
    client: AppServerClient,
  ): Promise<SharedServerMetadata["serverDiagnostics"]["probes"]["models"]> {
    try {
      const models = cloneModelMetadata(await this.client.fetchQuery(this.modelsQueryOptionsWithClient(context, client)));
      return diagnosticProbeOk("models", `${String(models.length)} models`, Date.now());
    } catch (error) {
      return diagnosticProbeError("models", error, Date.now());
    }
  }

  private modelsQueryOptionsWithClient(
    context: AppServerQueryContext,
    client: AppServerClient,
  ): AppServerQueryOptions<readonly ModelMetadata[]> {
    const refreshContext = cloneAppServerQueryContext(context);
    return {
      ...this.modelsQueryOptions(refreshContext),
      queryFn: async (): Promise<readonly ModelMetadata[]> => cloneModelMetadata(await listModelMetadata(client)),
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

  private metadataRevision(context: AppServerQueryContext): number {
    return this.metadataWriteRevisions.get(this.metadataWriteRevisionKey(context)) ?? 0;
  }

  private bumpMetadataRevision(context: AppServerQueryContext): void {
    this.beginMetadataResourceRefresh(context, "skills");
    this.beginMetadataResourceRefresh(context, "rateLimits");
  }

  private bumpMetadataWriteRevision(context: AppServerQueryContext): void {
    const key = this.metadataWriteRevisionKey(context);
    const revision = this.metadataRevision(context) + 1;
    this.metadataWriteRevisions.delete(key);
    this.metadataWriteRevisions.set(key, revision);
    while (this.metadataWriteRevisions.size > 8) {
      for (const oldestKey of this.metadataWriteRevisions.keys()) {
        this.metadataWriteRevisions.delete(oldestKey);
        break;
      }
    }
  }

  private metadataWriteRevisionKey(context: AppServerQueryContext): string {
    return JSON.stringify(appServerMetadataQueryKey(context));
  }

  private metadataResourceRevisionKey(context: AppServerQueryContext, resource: MetadataResourceKind): string {
    return JSON.stringify([...appServerMetadataQueryKey(context), resource]);
  }
}

function metadataWithLastKnownGood(metadata: SharedServerMetadata, previous: SharedServerMetadata | null): SharedServerMetadata {
  const probes = metadata.serverDiagnostics.probes;
  return cloneSharedServerMetadata({
    ...metadata,
    availableSkills: probes.skills.status === "ok" ? metadata.availableSkills : (previous?.availableSkills ?? []),
    availablePermissionProfiles:
      probes.permissionProfiles.status === "ok" ? metadata.availablePermissionProfiles : (previous?.availablePermissionProfiles ?? []),
    rateLimit: probes.rateLimits.status === "ok" ? metadata.rateLimit : (previous?.rateLimit ?? null),
    serverDiagnostics: metadataResourceDiagnostics(metadata.serverDiagnostics),
  });
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
