import {
  CancelledError,
  type InfiniteData,
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
  createServerDiagnostics,
  type DiagnosticProbeResult,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
} from "../../domain/server/diagnostics";
import type { SharedServerMetadata, SharedServerMetadataResource } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import type { AppServerClient } from "../connection/client";
import type { AppServerClientAccessOptions } from "../connection/client-access";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { listModelMetadata } from "../services/catalog";
import { readEffectiveConfig } from "../services/runtime-metadata";
import { listThreads, readThreadPage, type ThreadPage } from "../services/threads";
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
import { cloneModelMetadata, cloneSharedServerMetadata, cloneSharedServerMetadataResource, cloneThreads } from "./snapshots";
import { applyThreadListMutation, type ThreadListKind, type ThreadListMutation } from "./thread-list-mutation";

const MODELS_STALE_TIME_MS = 60_000;

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
  readonly staleTime?: number;
}

type ActiveThreadPageParam = string | null;
type ActiveThreadListData = InfiniteData<ThreadPage, ActiveThreadPageParam>;
type ActiveThreadsQueryKey = ReturnType<typeof activeThreadsQueryKey>;

interface MetadataResourceSnapshot<T> {
  readonly value: T;
  readonly probe: DiagnosticProbeResult;
}

type MetadataResourceKind = "skills" | "permissionProfiles" | "rateLimits";
type MetadataResourceValue = readonly SkillMetadata[] | readonly RuntimePermissionProfileSummary[] | RateLimitSnapshot | null;

export class AppServerQueryCache {
  private readonly context: AppServerQueryContext;
  private readonly client: QueryClient;
  private readonly clientRunner: AppServerQueryClientRunner | null;
  private disposed = false;

  constructor(context: AppServerQueryContext, options: { client?: QueryClient; clientRunner?: AppServerQueryClientRunner } = {}) {
    this.context = cloneAppServerQueryContextIdentity(context);
    this.client = options.client ?? createAppServerQueryClient();
    this.clientRunner = options.clientRunner ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    const observer = this.activeThreadListObserver();
    const emit = (result: InfiniteQueryObserverResult<ActiveThreadListData>): void => {
      listener(this.projectObservedResult(result, flattenActiveThreadList));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return unsubscribe;
  }

  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.assertUsable();
    return this.observeQueryResult(this.archivedThreadListQueryOptions(), cloneThreads, listener, options);
  }

  async refreshActiveThreads(): Promise<readonly Thread[]> {
    this.assertUsable();
    return this.refreshActiveThreadList();
  }

  async fetchAllActiveThreads(): Promise<readonly Thread[]> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return [];
    return cloneThreads(await this.runWithClient((client) => listThreads(client, this.context.vaultPath)));
  }

  hasMoreActiveThreads(): boolean {
    if (this.disposed) return false;
    if (!appServerQueryContextIsComplete(this.context)) return false;
    return Boolean(this.activeThreadListData()?.pages.at(-1)?.nextCursor);
  }

  async loadMoreActiveThreads(): Promise<readonly Thread[]> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const current = this.activeThreadsSnapshot() ?? (await this.fetchActiveThreadList());
    if (!this.hasMoreActiveThreads()) return current;
    const observer = this.activeThreadListObserver();
    try {
      const result = await observer.fetchNextPage({ cancelRefetch: false, throwOnError: true });
      this.assertUsable();
      return result.data ? flattenActiveThreadList(result.data) : current;
    } catch (error) {
      if (error instanceof CancelledError) return this.activeThreadsSnapshot() ?? current;
      throw error;
    } finally {
      observer.destroy();
    }
  }

  async refreshArchivedThreads(): Promise<readonly Thread[]> {
    this.assertUsable();
    return this.refreshArchivedThreadList();
  }

  applyThreadListMutations(mutations: readonly ThreadListMutation[]): void {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context) || mutations.length === 0) return;
    for (const kind of ["active", "archived"] as const) {
      const relevant = mutations.filter((mutation) => mutation.list === kind);
      if (relevant.length === 0) continue;

      const key = kind === "active" ? activeThreadsQueryKey(this.context) : archivedThreadsQueryKey(this.context);
      const before = this.threadListSnapshot(kind);
      const wasFetching = this.client.getQueryState(key)?.fetchStatus === "fetching";
      const activeFetchIsNextPage = wasFetching && kind === "active" && this.activeThreadListIsFetchingNextPage();
      void this.client.cancelQueries({ queryKey: key, exact: true });
      if (kind === "active") {
        for (const mutation of relevant) this.projectActiveThreadListMutation(mutation);
      } else {
        const projected = before ? relevant.reduce<readonly Thread[] | null>(applyThreadListMutation, before) : null;
        if (projected) this.client.setQueryData(archivedThreadsQueryKey(this.context), cloneThreads(projected));
      }
      if (wasFetching && !activeFetchIsNextPage) {
        const refresh = kind === "active" ? this.refreshActiveThreadList() : this.refreshArchivedThreadList();
        void refresh.catch(() => {
          // Query observers retain refresh failures while the event projection remains last-known-good state.
        });
      }
    }
  }

  private threadListSnapshot(kind: ThreadListKind): readonly Thread[] | null {
    if (!appServerQueryContextIsComplete(this.context)) return null;
    if (kind === "active") {
      const data = this.activeThreadListData();
      return data ? flattenActiveThreadList(data) : null;
    }
    const threads = this.client.getQueryData<readonly Thread[]>(archivedThreadsQueryKey(this.context));
    return threads ? cloneThreads(threads) : null;
  }

  private async refreshActiveThreadList(): Promise<readonly Thread[]> {
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const key = activeThreadsQueryKey(this.context);
    if (this.activeThreadListIsFetchingNextPage()) await this.client.cancelQueries({ queryKey: key, exact: true });
    await this.client.invalidateQueries({ queryKey: key, refetchType: "none" });
    this.assertUsable();
    return this.fetchActiveThreadList();
  }

  private async fetchActiveThreadList(): Promise<readonly Thread[]> {
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const queryOptions = { ...this.activeThreadListQueryOptions(), pages: 1 };
    let data: ActiveThreadListData;
    try {
      data = await this.client.fetchInfiniteQuery(queryOptions);
    } catch (error) {
      if (!(error instanceof CancelledError) || this.activeThreadListData()) throw error;
      data = await this.client.fetchInfiniteQuery(queryOptions);
    }
    this.assertUsable();
    return flattenActiveThreadList(data);
  }

  private async refreshArchivedThreadList(): Promise<readonly Thread[]> {
    if (!appServerQueryContextIsComplete(this.context)) return [];
    const key = archivedThreadsQueryKey(this.context);
    await this.client.invalidateQueries({ queryKey: key, refetchType: "none" });
    this.assertUsable();
    return this.fetchArchivedThreadList();
  }

  private async fetchArchivedThreadList(): Promise<readonly Thread[]> {
    if (!appServerQueryContextIsComplete(this.context)) return [];
    let threads: readonly Thread[];
    try {
      threads = await this.client.fetchQuery(this.archivedThreadListQueryOptions());
    } catch (error) {
      if (!(error instanceof CancelledError) || this.archivedThreadsSnapshot()) throw error;
      threads = await this.client.fetchQuery(this.archivedThreadListQueryOptions());
    }
    this.assertUsable();
    return cloneThreads(threads);
  }

  private projectActiveThreadListMutation(mutation: ThreadListMutation): void {
    this.client.setQueryData<ActiveThreadListData>(activeThreadsQueryKey(this.context), (data) => {
      if (!data) return data;
      if (mutation.kind === "upsert") {
        const existing = data.pages.some((page) => page.threads.some((thread) => thread.id === mutation.thread.id));
        const pages = data.pages.map((page) => ({
          ...page,
          threads: page.threads.map((thread) => (thread.id === mutation.thread.id ? mutation.thread : thread)),
        }));
        const first = pages[0];
        if (!existing && first) pages[0] = { ...first, threads: [mutation.thread, ...first.threads] };
        return { ...data, pages };
      }
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          threads: applyThreadListMutation(page.threads, mutation) ?? page.threads,
        })),
      };
    });
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

  observeAppServerMetadataResources(
    listener: (resource: SharedServerMetadataResource) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    this.assertUsable();
    let disposed = false;
    const emit = (resource: SharedServerMetadataResource): void => {
      if (!disposed) listener(cloneSharedServerMetadataResource(resource));
    };

    const runtimeConfig = new QueryObserver(this.client, { ...this.runtimeConfigQueryOptions(), enabled: false });
    const models = new QueryObserver(this.client, { ...this.modelsQueryOptions(), enabled: false });
    const skills = new QueryObserver(this.client, { ...this.skillsQueryOptions(), enabled: false });
    const permissionProfiles = new QueryObserver(this.client, { ...this.permissionProfilesQueryOptions(), enabled: false });
    const rateLimits = new QueryObserver(this.client, { ...this.rateLimitsQueryOptions(), enabled: false });
    const emitRuntimeConfig = (result: QueryObserverResult<RuntimeConfigSnapshot>, includeFetching = false): void => {
      if (result.isFetching && !includeFetching) return;
      emit({ id: "runtimeConfig", value: result.data ? cloneRuntimeConfigSnapshot(result.data) : undefined });
    };
    const emitModels = (result: QueryObserverResult<readonly ModelMetadata[]>, includeFetching = false): void => {
      if (result.isFetching && !includeFetching) return;
      emit({ id: "models", value: result.data ? cloneModelMetadata(result.data) : undefined, probe: this.modelsProbe() });
    };
    const emitSkills = (result: QueryObserverResult<MetadataResourceSnapshot<readonly SkillMetadata[]>>, includeFetching = false): void => {
      if (result.isFetching && !includeFetching) return;
      const state = this.metadataResourceState("skills");
      emit({ id: "skills", value: state.value ?? undefined, probe: state.probe });
    };
    const emitPermissionProfiles = (
      result: QueryObserverResult<MetadataResourceSnapshot<readonly RuntimePermissionProfileSummary[]>>,
      includeFetching = false,
    ): void => {
      if (result.isFetching && !includeFetching) return;
      const state = this.metadataResourceState("permissionProfiles");
      emit({ id: "permissionProfiles", value: state.value ?? undefined, probe: state.probe });
    };
    const emitRateLimits = (
      result: QueryObserverResult<MetadataResourceSnapshot<RateLimitSnapshot | null>>,
      includeFetching = false,
    ): void => {
      if (result.isFetching && !includeFetching) return;
      const state = this.metadataResourceState("rateLimits");
      emit({ id: "rateLimits", value: state.value, probe: state.probe });
    };
    const unsubscribers = [
      runtimeConfig.subscribe(emitRuntimeConfig),
      models.subscribe(emitModels),
      skills.subscribe(emitSkills),
      permissionProfiles.subscribe(emitPermissionProfiles),
      rateLimits.subscribe(emitRateLimits),
    ];
    if (options.emitCurrent ?? true) {
      emitRuntimeConfig(runtimeConfig.getCurrentResult(), true);
      emitModels(models.getCurrentResult(), true);
      emitSkills(skills.getCurrentResult(), true);
      emitPermissionProfiles(permissionProfiles.getCurrentResult(), true);
      emitRateLimits(rateLimits.getCurrentResult(), true);
    }
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  async refreshAppServerMetadata(): Promise<void> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return;
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
  }

  async refreshSkills(): Promise<void> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return;
    await this.refreshNotifiedMetadataResource("skills");
    this.assertUsable();
  }

  async refreshRateLimits(): Promise<void> {
    this.assertUsable();
    if (!appServerQueryContextIsComplete(this.context)) return;
    await this.refreshNotifiedMetadataResource("rateLimits");
    this.assertUsable();
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
      await this.client.invalidateQueries({ queryKey: key, refetchType: "none" });
      this.assertUsable();
    }
    const models = await this.client.fetchQuery(this.modelsQueryOptions());
    this.assertUsable();
    return cloneModelMetadata(models);
  }

  async refreshModels(): Promise<readonly ModelMetadata[]> {
    return this.fetchModels({ force: true });
  }

  private activeThreadListQueryOptions(): InfiniteQueryObserverOptions<
    ThreadPage,
    Error,
    ActiveThreadListData,
    ActiveThreadsQueryKey,
    ActiveThreadPageParam
  > {
    return {
      queryKey: activeThreadsQueryKey(this.context),
      queryFn: ({ pageParam }) =>
        this.runWithClient((client) => readThreadPage(client, this.context.vaultPath, { cursor: pageParam, archived: false })),
      initialPageParam: null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: Number.POSITIVE_INFINITY,
    };
  }

  private activeThreadListObserver(): InfiniteQueryObserver<
    ThreadPage,
    Error,
    ActiveThreadListData,
    ActiveThreadsQueryKey,
    ActiveThreadPageParam
  > {
    return new InfiniteQueryObserver(this.client, {
      ...this.activeThreadListQueryOptions(),
      enabled: false,
    });
  }

  private activeThreadListIsFetchingNextPage(): boolean {
    const observer = this.activeThreadListObserver();
    const isFetchingNextPage = observer.getCurrentResult().isFetchingNextPage;
    observer.destroy();
    return isFetchingNextPage;
  }

  private archivedThreadListQueryOptions(): AppServerQueryOptions<readonly Thread[]> {
    return {
      queryKey: archivedThreadsQueryKey(this.context),
      queryFn: () => this.runWithClient((client) => listThreads(client, this.context.vaultPath, { archived: true })).then(cloneThreads),
      staleTime: Number.POSITIVE_INFINITY,
    };
  }

  private runtimeConfigQueryOptions(): AppServerQueryOptions<RuntimeConfigSnapshot> {
    return {
      queryKey: appServerRuntimeConfigQueryKey(this.context),
      queryFn: async (): Promise<RuntimeConfigSnapshot> =>
        this.runWithClient(async (client) =>
          runtimeConfigSnapshotFromAppServerConfig(await readEffectiveConfig(client, this.context.vaultPath)),
        ),
    };
  }

  private skillsQueryOptions(): AppServerQueryOptions<MetadataResourceSnapshot<readonly SkillMetadata[]>> {
    return {
      queryKey: appServerSkillsQueryKey(this.context),
      queryFn: async () =>
        this.runWithClient(async (client) => successfulMetadataResource(await readSkillMetadataProbe(client, this.context.vaultPath))),
    };
  }

  private permissionProfilesQueryOptions(): AppServerQueryOptions<MetadataResourceSnapshot<readonly RuntimePermissionProfileSummary[]>> {
    return {
      queryKey: appServerPermissionProfilesQueryKey(this.context),
      queryFn: async () =>
        this.runWithClient(async (client) =>
          successfulMetadataResource(await readPermissionProfileMetadataProbe(client, this.context.vaultPath)),
        ),
    };
  }

  private rateLimitsQueryOptions(): AppServerQueryOptions<MetadataResourceSnapshot<RateLimitSnapshot | null>> {
    return {
      queryKey: appServerRateLimitsQueryKey(this.context),
      queryFn: async () => this.runWithClient(async (client) => successfulMetadataResource(await readRateLimitMetadataProbe(client))),
    };
  }

  private async fetchRuntimeConfig(): Promise<RuntimeConfigSnapshot> {
    const runtimeConfig = await this.client.fetchQuery(this.runtimeConfigQueryOptions());
    this.assertUsable();
    return cloneRuntimeConfigSnapshot(runtimeConfig);
  }

  private fetchMetadataResource(resource: MetadataResourceKind): Promise<void> {
    return (async (): Promise<void> => {
      if (resource === "skills") {
        const options = this.skillsQueryOptions();
        await this.client.fetchQuery(options);
        this.assertUsable();
        return;
      }
      if (resource === "permissionProfiles") {
        const options = this.permissionProfilesQueryOptions();
        await this.client.fetchQuery(options);
        this.assertUsable();
        return;
      }
      const options = this.rateLimitsQueryOptions();
      await this.client.fetchQuery(options);
      this.assertUsable();
    })();
  }

  private async refreshNotifiedMetadataResource(resource: "skills" | "rateLimits"): Promise<void> {
    const queryKey = resource === "skills" ? appServerSkillsQueryKey(this.context) : appServerRateLimitsQueryKey(this.context);
    await this.client.cancelQueries({ queryKey, exact: true });
    this.assertUsable();
    try {
      await this.fetchMetadataResource(resource);
    } catch (error) {
      if (!(error instanceof CancelledError)) throw error;
    }
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
      listener(this.projectObservedResult(result, project));
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult());
    return unsubscribe;
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

  private runWithClient<T>(operation: (client: AppServerClient) => Promise<T>, options: AppServerClientAccessOptions = {}): Promise<T> {
    this.assertUsable();
    const runner = this.clientRunner;
    if (!runner) throw new Error("Codex app-server query client runner is not configured.");
    return runner.runWithClient(this.context, operation, options);
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Codex app-server query cache was disposed.");
  }

  private activeThreadListData(): ActiveThreadListData | null {
    if (!appServerQueryContextIsComplete(this.context)) return null;
    return this.client.getQueryData<ActiveThreadListData>(activeThreadsQueryKey(this.context)) ?? null;
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

function flattenActiveThreadList(data: ActiveThreadListData): readonly Thread[] {
  return cloneThreads(data.pages.flatMap((page) => page.threads));
}

function createAppServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
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
