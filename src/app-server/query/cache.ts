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
import { listThreads } from "../services/threads";
import {
  type AppServerQueryContext,
  activeThreadsQueryKey,
  appServerMetadataQueryKey,
  appServerModelsQueryKey,
  appServerQueriesFilter,
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
type ThreadListUpdater = (threads: readonly Thread[] | null) => readonly Thread[] | null;

export class AppServerQueryCache {
  readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;

  constructor(options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
  }

  clear(): void {
    this.client.clear();
  }

  clearContext(context: AppServerQueryContext): void {
    if (!appServerQueryContextIsComplete(context)) return;
    const filter = appServerQueriesFilter(context);
    void this.client.cancelQueries(filter);
    this.client.removeQueries(filter);
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
    this.client.setQueryData(this.threadListQueryKey(context, kind), cloneThreads(threads));
  }

  private updateThreadList(context: AppServerQueryContext, kind: ThreadListKind, updater: ThreadListUpdater): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
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
        return cloneThreads(
          await this.runWithClient(refreshContext, (client) =>
            listThreads(client, refreshContext.vaultPath, { archived: kind === "archived" }),
          ),
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
        return this.runWithClient(refreshContext, async (client) => {
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
