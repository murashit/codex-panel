import { QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/query-core";

import type { AppServerClient } from "../connection/client";
import type { AppServerClientAccessOptions } from "../connection/client-access";
import { listModelMetadata } from "../catalog";
import { readRateLimitMetadataProbe, readSkillMetadataProbe } from "./metadata-probes";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { listThreads } from "../threads";
import type { ModelMetadata } from "../../domain/catalog/metadata";
import { createServerDiagnostics, diagnosticProbeError, diagnosticProbeOk, diagnosticsWithProbe } from "../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import {
  activeThreadsQueryKey,
  archivedThreadsQueryKey,
  appServerMetadataQueryKey,
  appServerModelsQueryKey,
  appServerQueriesFilter,
  appServerQueryContextIsComplete,
  cloneAppServerQueryContext,
  type AppServerQueryContext,
} from "./keys";
import { cloneModelMetadata, cloneSharedServerMetadata, cloneThreads } from "./snapshots";

const THREAD_LIST_STALE_TIME_MS = 10_000;
const APP_SERVER_METADATA_STALE_TIME_MS = 10_000;
const MODELS_STALE_TIME_MS = 60_000;

export interface AppServerQueryClientRunner {
  runWithClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options?: AppServerClientAccessOptions,
  ): Promise<T>;
}

export type AppServerObservedQueryResult<T> = Omit<QueryObserverResult<T>, "data" | "error"> & {
  readonly data: T | null;
  readonly error: Error | null;
};

interface AppServerQueryOptions<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: () => Promise<T>;
  readonly staleTime: number;
}

type ThreadListKind = "active" | "archived";
type ThreadListUpdater = (threads: readonly Thread[] | null) => readonly Thread[] | null;

interface ThreadListMutationOverlay {
  readonly version: number;
  readonly update: ThreadListUpdater;
}

interface AppliedThreadListMutationOverlays {
  readonly applied: boolean;
  readonly threads: readonly Thread[];
}

export class AppServerQueryCache {
  readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;
  private readonly threadListWriteVersions = new Map<string, number>();
  private readonly threadListMutationOverlays = new Map<string, ThreadListMutationOverlay[]>();

  constructor(options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
  }

  clear(): void {
    this.client.clear();
    this.threadListWriteVersions.clear();
    this.threadListMutationOverlays.clear();
  }

  clearContext(context: AppServerQueryContext): void {
    if (!appServerQueryContextIsComplete(context)) return;
    const filter = appServerQueriesFilter(context);
    void this.client.cancelQueries(filter);
    this.client.removeQueries(filter);
    this.clearThreadListContext(context, "active");
    this.clearThreadListContext(context, "archived");
  }

  activeThreadsSnapshot(context: AppServerQueryContext): readonly Thread[] | null {
    return this.threadListSnapshot(context, "active");
  }

  archivedThreadsSnapshot(context: AppServerQueryContext): readonly Thread[] | null {
    return this.threadListSnapshot(context, "archived");
  }

  observeActiveThreadsResult(
    context: AppServerQueryContext,
    listener: (result: AppServerObservedQueryResult<readonly Thread[]>) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQueryResult(this.threadListQueryOptions(context, "active"), cloneThreads, listener, options);
  }

  observeArchivedThreadsResult(
    context: AppServerQueryContext,
    listener: (result: AppServerObservedQueryResult<readonly Thread[]>) => void,
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

  async refreshArchivedThreads(context: AppServerQueryContext): Promise<readonly Thread[]> {
    return this.fetchArchivedThreads(context, { force: true });
  }

  setActiveThreads(context: AppServerQueryContext, threads: readonly Thread[]): void {
    this.setThreadList(context, "active", threads);
  }

  setArchivedThreads(context: AppServerQueryContext, threads: readonly Thread[]): void {
    this.setThreadList(context, "archived", threads);
  }

  updateActiveThreads(context: AppServerQueryContext, updater: ThreadListUpdater): readonly Thread[] | null {
    return this.updateThreadList(context, "active", updater);
  }

  updateArchivedThreads(context: AppServerQueryContext, updater: ThreadListUpdater): readonly Thread[] | null {
    return this.updateThreadList(context, "archived", updater);
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

  private setThreadList(context: AppServerQueryContext, kind: ThreadListKind, threads: readonly Thread[]): void {
    if (!appServerQueryContextIsComplete(context)) return;
    this.bumpThreadListWriteVersion(context, kind);
    this.threadListMutationOverlays.delete(this.threadListCacheKey(context, kind));
    this.client.setQueryData(this.threadListQueryKey(context, kind), cloneThreads(threads));
  }

  private updateThreadList(context: AppServerQueryContext, kind: ThreadListKind, updater: ThreadListUpdater): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const version = this.bumpThreadListWriteVersion(context, kind);
    this.recordThreadListMutationOverlay(context, kind, { version, update: updater });
    const current = this.threadListSnapshot(context, kind);
    const next = updater(current);
    if (!next) return null;
    this.client.setQueryData(this.threadListQueryKey(context, kind), cloneThreads(next), current ? undefined : { updatedAt: 0 });
    return cloneThreads(next);
  }

  appServerMetadataSnapshot(context: AppServerQueryContext): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const metadata = this.client.getQueryData<SharedServerMetadata>(appServerMetadataQueryKey(context));
    return metadata ? cloneSharedServerMetadata(metadata) : null;
  }

  observeAppServerMetadataResult(
    context: AppServerQueryContext,
    listener: (result: AppServerObservedQueryResult<SharedServerMetadata>) => void,
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
    const key = appServerMetadataQueryKey(refreshContext);
    await Promise.all([
      this.client.invalidateQueries({ queryKey: key }),
      this.client.invalidateQueries({ queryKey: appServerModelsQueryKey(refreshContext) }),
    ]);
    const metadata = await this.client.fetchQuery(this.appServerMetadataQueryOptions(refreshContext, options));
    return this.writeAppServerMetadata(refreshContext, metadata);
  }

  writeAppServerMetadata(context: AppServerQueryContext, metadata: SharedServerMetadata): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const next = cloneSharedServerMetadata({
      ...metadata,
      availableModels:
        metadata.serverDiagnostics.probes["model/list"].status === "ok" ? metadata.availableModels : (this.modelsSnapshot(context) ?? []),
    });
    this.client.setQueryData(appServerMetadataQueryKey(context), cloneSharedServerMetadata(next));
    if (metadata.serverDiagnostics.probes["model/list"].status === "ok") {
      this.client.setQueryData(appServerModelsQueryKey(context), cloneModelMetadata(next.availableModels));
    }
    return cloneSharedServerMetadata(next);
  }

  updateAppServerMetadata(
    context: AppServerQueryContext,
    updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null,
  ): SharedServerMetadata | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const next = updater(this.appServerMetadataSnapshot(context));
    return next ? this.writeAppServerMetadata(context, next) : null;
  }

  modelsSnapshot(context: AppServerQueryContext): readonly ModelMetadata[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const models = this.client.getQueryData<readonly ModelMetadata[]>(appServerModelsQueryKey(context));
    return models ? cloneModelMetadata(models) : null;
  }

  observeModelsResult(
    context: AppServerQueryContext,
    listener: (result: AppServerObservedQueryResult<readonly ModelMetadata[]>) => void,
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
    const key = this.threadListQueryKey(refreshContext, kind);
    const writeVersion = this.threadListWriteVersion(refreshContext, kind);
    return {
      queryKey: key,
      queryFn: async (): Promise<readonly Thread[]> => {
        const threads = cloneThreads(
          await this.runWithClient(refreshContext, (client) =>
            listThreads(client, refreshContext.vaultPath, { archived: kind === "archived" }),
          ),
        );
        const currentWriteVersion = this.threadListWriteVersion(refreshContext, kind);
        if (currentWriteVersion !== writeVersion) {
          const overlaid = this.applyThreadListMutationOverlays(refreshContext, kind, threads, writeVersion);
          if (overlaid.applied) return cloneThreads(overlaid.threads);
          const cached = this.client.getQueryData<readonly Thread[]>(key);
          if (cached) return cloneThreads(cached);
          return threads;
        }
        this.pruneThreadListMutationOverlays(refreshContext, kind, writeVersion);
        return threads;
      },
      staleTime: THREAD_LIST_STALE_TIME_MS,
    };
  }

  private threadListWriteVersion(context: AppServerQueryContext, kind: ThreadListKind): number {
    return this.threadListWriteVersions.get(this.threadListCacheKey(context, kind)) ?? 0;
  }

  private bumpThreadListWriteVersion(context: AppServerQueryContext, kind: ThreadListKind): number {
    const key = this.threadListCacheKey(context, kind);
    const version = (this.threadListWriteVersions.get(key) ?? 0) + 1;
    this.threadListWriteVersions.set(key, version);
    return version;
  }

  private clearThreadListContext(context: AppServerQueryContext, kind: ThreadListKind): void {
    const key = this.threadListCacheKey(context, kind);
    this.threadListWriteVersions.delete(key);
    this.threadListMutationOverlays.delete(key);
  }

  private threadListCacheKey(context: AppServerQueryContext, kind: ThreadListKind): string {
    return JSON.stringify(this.threadListQueryKey(context, kind));
  }

  private threadListQueryKey(
    context: AppServerQueryContext,
    kind: ThreadListKind,
  ): ReturnType<typeof activeThreadsQueryKey> | ReturnType<typeof archivedThreadsQueryKey> {
    return kind === "archived" ? archivedThreadsQueryKey(context) : activeThreadsQueryKey(context);
  }

  private recordThreadListMutationOverlay(context: AppServerQueryContext, kind: ThreadListKind, overlay: ThreadListMutationOverlay): void {
    const key = this.threadListCacheKey(context, kind);
    this.threadListMutationOverlays.set(key, [...(this.threadListMutationOverlays.get(key) ?? []), overlay]);
  }

  private applyThreadListMutationOverlays(
    context: AppServerQueryContext,
    kind: ThreadListKind,
    threads: readonly Thread[],
    afterVersion: number,
  ): AppliedThreadListMutationOverlays {
    const overlays = this.threadListMutationOverlays
      .get(this.threadListCacheKey(context, kind))
      ?.filter((overlay) => overlay.version > afterVersion);
    if (!overlays || overlays.length === 0) return { applied: false, threads };
    return {
      applied: true,
      threads: overlays.reduce<readonly Thread[]>((current, overlay) => overlay.update(current) ?? current, threads),
    };
  }

  private pruneThreadListMutationOverlays(context: AppServerQueryContext, kind: ThreadListKind, throughVersion: number): void {
    const key = this.threadListCacheKey(context, kind);
    const overlays = this.threadListMutationOverlays.get(key)?.filter((overlay) => overlay.version > throughVersion);
    if (!overlays || overlays.length === 0) {
      this.threadListMutationOverlays.delete(key);
      return;
    }
    this.threadListMutationOverlays.set(key, overlays);
  }

  private appServerMetadataQueryOptions(
    context: AppServerQueryContext,
    options: { forceSkills?: boolean } = {},
  ): AppServerQueryOptions<SharedServerMetadata> {
    const refreshContext = cloneAppServerQueryContext(context);
    return {
      queryKey: appServerMetadataQueryKey(refreshContext),
      queryFn: async (): Promise<SharedServerMetadata> => {
        return this.runWithClient(refreshContext, async (client) => {
          const runtimeConfig = runtimeConfigSnapshotFromAppServerConfig(await client.readEffectiveConfig(refreshContext.vaultPath));
          const [models, skills, rateLimit] = await Promise.all([
            this.readModelMetadataProbe(refreshContext, client),
            readSkillMetadataProbe(client, refreshContext.vaultPath, options.forceSkills ?? false),
            readRateLimitMetadataProbe(client),
          ]);
          const diagnostics = [models.probe, skills.probe, rateLimit.probe].reduce(
            (current, probe) => diagnosticsWithProbe(current, probe),
            this.appServerMetadataSnapshot(refreshContext)?.serverDiagnostics ?? createServerDiagnostics(),
          );
          return {
            runtimeConfig,
            availableModels: models.data,
            availableSkills: skills.data,
            rateLimit: rateLimit.data,
            serverDiagnostics: diagnostics,
          };
        });
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
  ): Promise<{
    data: readonly ModelMetadata[];
    probe: SharedServerMetadata["serverDiagnostics"]["probes"]["model/list"];
  }> {
    try {
      const data = cloneModelMetadata(await this.client.fetchQuery(this.modelsQueryOptionsWithClient(context, client)));
      return { data, probe: diagnosticProbeOk("model/list", `${String(data.length)} models`, Date.now()) };
    } catch (error) {
      return {
        data: this.modelsSnapshot(context) ?? [],
        probe: diagnosticProbeError("model/list", error, Date.now()),
      };
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
    listener: (result: AppServerObservedQueryResult<T>) => void,
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

  private cloneObservedResult<T>(result: QueryObserverResult<T>, clone: (value: T) => T): AppServerObservedQueryResult<T> {
    return {
      ...result,
      data: result.data === undefined ? null : clone(result.data),
      error: result.error instanceof Error ? result.error : null,
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
}

function createAppServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
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
