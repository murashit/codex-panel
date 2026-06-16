import { QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/query-core";

import type { AppServerClient } from "../connection/client";
import { listModelMetadata } from "../catalog/data";
import { readRateLimitMetadataProbe, readSkillMetadataProbe } from "./metadata-probes";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { listThreads } from "../threads/data";
import type { ModelMetadata } from "../../domain/catalog/metadata";
import { createServerDiagnostics, diagnosticProbeError, diagnosticProbeOk, diagnosticsWithProbe } from "../../domain/server/diagnostics";
import type { SharedServerMetadata } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import {
  activeThreadsQueryKey,
  appServerMetadataQueryKey,
  appServerModelsQueryKey,
  appServerQueriesFilter,
  appServerQueryContextIsComplete,
  cloneAppServerQueryContext,
  type AppServerQueryContext,
} from "./keys";
import { cloneModelMetadata, cloneSharedServerMetadata, cloneThreads } from "./snapshots";

const ACTIVE_THREADS_STALE_TIME_MS = 10_000;
const APP_SERVER_METADATA_STALE_TIME_MS = 10_000;
const MODELS_STALE_TIME_MS = 60_000;

export interface AppServerQueryClientRunner {
  runWithClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options?: { unhandledServerRequestMessage?: string },
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

type ActiveThreadsUpdater = (threads: readonly Thread[] | null) => readonly Thread[] | null;

interface ActiveThreadsMutationOverlay {
  readonly version: number;
  readonly update: ActiveThreadsUpdater;
}

interface AppliedActiveThreadsMutationOverlays {
  readonly applied: boolean;
  readonly threads: readonly Thread[];
}

export class AppServerQueryCache {
  readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;
  private readonly activeThreadsWriteVersions = new Map<string, number>();
  private readonly activeThreadsMutationOverlays = new Map<string, ActiveThreadsMutationOverlay[]>();

  constructor(options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
  }

  clear(): void {
    this.client.clear();
    this.activeThreadsWriteVersions.clear();
    this.activeThreadsMutationOverlays.clear();
  }

  clearContext(context: AppServerQueryContext): void {
    if (!appServerQueryContextIsComplete(context)) return;
    const filter = appServerQueriesFilter(context);
    void this.client.cancelQueries(filter);
    this.client.removeQueries(filter);
    const key = this.activeThreadsCacheKey(context);
    this.activeThreadsWriteVersions.delete(key);
    this.activeThreadsMutationOverlays.delete(key);
  }

  activeThreadsSnapshot(context: AppServerQueryContext): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const threads = this.client.getQueryData<readonly Thread[]>(activeThreadsQueryKey(context));
    return threads ? cloneThreads(threads) : null;
  }

  observeActiveThreadsResult(
    context: AppServerQueryContext,
    listener: (result: AppServerObservedQueryResult<readonly Thread[]>) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    return this.observeQueryResult(this.activeThreadsQueryOptions(context), cloneThreads, listener, options);
  }

  async fetchActiveThreads(context: AppServerQueryContext, options: { force?: boolean } = {}): Promise<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContext(context);
    if (!appServerQueryContextIsComplete(refreshContext)) {
      return [];
    }
    const key = activeThreadsQueryKey(refreshContext);
    if (options.force) await this.client.invalidateQueries({ queryKey: key });
    const threads = await this.client.fetchQuery(this.activeThreadsQueryOptions(refreshContext));
    return cloneThreads(threads);
  }

  async refreshActiveThreads(context: AppServerQueryContext): Promise<readonly Thread[]> {
    return this.fetchActiveThreads(context, { force: true });
  }

  setActiveThreads(context: AppServerQueryContext, threads: readonly Thread[]): void {
    if (!appServerQueryContextIsComplete(context)) return;
    this.bumpActiveThreadsWriteVersion(context);
    this.activeThreadsMutationOverlays.delete(this.activeThreadsCacheKey(context));
    this.client.setQueryData(activeThreadsQueryKey(context), cloneThreads(threads));
  }

  updateActiveThreads(context: AppServerQueryContext, updater: ActiveThreadsUpdater): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(context)) return null;
    const version = this.bumpActiveThreadsWriteVersion(context);
    this.recordActiveThreadsMutationOverlay(context, { version, update: updater });
    const current = this.activeThreadsSnapshot(context);
    const next = updater(current);
    if (!next) return null;
    this.client.setQueryData(activeThreadsQueryKey(context), cloneThreads(next), current ? undefined : { updatedAt: 0 });
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

  private activeThreadsQueryOptions(context: AppServerQueryContext): AppServerQueryOptions<readonly Thread[]> {
    const refreshContext = cloneAppServerQueryContext(context);
    const key = activeThreadsQueryKey(refreshContext);
    const writeVersion = this.activeThreadsWriteVersion(refreshContext);
    return {
      queryKey: key,
      queryFn: async (): Promise<readonly Thread[]> => {
        const threads = cloneThreads(await this.runWithClient(refreshContext, (client) => listThreads(client, refreshContext.vaultPath)));
        const currentWriteVersion = this.activeThreadsWriteVersion(refreshContext);
        if (currentWriteVersion !== writeVersion) {
          const overlaid = this.applyActiveThreadsMutationOverlays(refreshContext, threads, writeVersion);
          if (overlaid.applied) return cloneThreads(overlaid.threads);
          const cached = this.client.getQueryData<readonly Thread[]>(key);
          if (cached) return cloneThreads(cached);
          return threads;
        }
        this.pruneActiveThreadsMutationOverlays(refreshContext, writeVersion);
        return threads;
      },
      staleTime: ACTIVE_THREADS_STALE_TIME_MS,
    };
  }

  private activeThreadsWriteVersion(context: AppServerQueryContext): number {
    return this.activeThreadsWriteVersions.get(this.activeThreadsCacheKey(context)) ?? 0;
  }

  private bumpActiveThreadsWriteVersion(context: AppServerQueryContext): number {
    const key = this.activeThreadsCacheKey(context);
    const version = (this.activeThreadsWriteVersions.get(key) ?? 0) + 1;
    this.activeThreadsWriteVersions.set(key, version);
    return version;
  }

  private activeThreadsCacheKey(context: AppServerQueryContext): string {
    return JSON.stringify(activeThreadsQueryKey(context));
  }

  private recordActiveThreadsMutationOverlay(context: AppServerQueryContext, overlay: ActiveThreadsMutationOverlay): void {
    const key = this.activeThreadsCacheKey(context);
    this.activeThreadsMutationOverlays.set(key, [...(this.activeThreadsMutationOverlays.get(key) ?? []), overlay]);
  }

  private applyActiveThreadsMutationOverlays(
    context: AppServerQueryContext,
    threads: readonly Thread[],
    afterVersion: number,
  ): AppliedActiveThreadsMutationOverlays {
    const overlays = this.activeThreadsMutationOverlays
      .get(this.activeThreadsCacheKey(context))
      ?.filter((overlay) => overlay.version > afterVersion);
    if (!overlays || overlays.length === 0) return { applied: false, threads };
    return {
      applied: true,
      threads: overlays.reduce<readonly Thread[]>((current, overlay) => overlay.update(current) ?? current, threads),
    };
  }

  private pruneActiveThreadsMutationOverlays(context: AppServerQueryContext, throughVersion: number): void {
    const key = this.activeThreadsCacheKey(context);
    const overlays = this.activeThreadsMutationOverlays.get(key)?.filter((overlay) => overlay.version > throughVersion);
    if (!overlays || overlays.length === 0) {
      this.activeThreadsMutationOverlays.delete(key);
      return;
    }
    this.activeThreadsMutationOverlays.set(key, overlays);
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
            unhandledServerRequestMessage: "Codex model list refresh does not handle server requests.",
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
      return { data, probe: diagnosticProbeOk("model/list", `${String(data.length)} models`) };
    } catch (error) {
      return {
        data: this.modelsSnapshot(context) ?? [],
        probe: diagnosticProbeError("model/list", error),
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
    options: { unhandledServerRequestMessage?: string } = {},
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
