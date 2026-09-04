import { QueryObserver, type QueryObserverResult } from "@tanstack/query-core";
import type { HookCatalog, HookItem, ModelMetadata, SkillMetadata } from "../../domain/catalog/metadata";
import { cloneRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../domain/runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../../domain/runtime/permissions";
import {
  createMetadataResourceDiagnostics,
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
import type { ObservedResultListener } from "../../shared/async/observed-result";
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { accountRateLimitsSummaryFromResponse, rateLimitSnapshotFromAccountRateLimitsResponse } from "../protocol/runtime-metrics";
import {
  listHookCatalog,
  listModelMetadata,
  listPermissionProfiles,
  listSkillCatalog,
  setHookItemEnabled,
  trustHookItem,
} from "../services/catalog";
import type { AppServerRequestClient } from "../services/request-client";
import { readAccountRateLimits, readEffectiveConfig } from "../services/runtime-metadata";
import type { AppServerQueryOptions, AppServerQueryScope } from "./query-scope";
import { cloneModelMetadata, cloneRateLimitSnapshot, cloneSharedServerMetadataResource } from "./snapshots";

const METADATA_QUERY_KEY = ["metadata"] as const;
const MODELS_QUERY_KEY = [...METADATA_QUERY_KEY, "models"] as const;
const RUNTIME_CONFIG_QUERY_KEY = [...METADATA_QUERY_KEY, "runtime-config"] as const;
const SKILLS_QUERY_KEY = [...METADATA_QUERY_KEY, "skills"] as const;
const PERMISSION_PROFILES_QUERY_KEY = [...METADATA_QUERY_KEY, "permission-profiles"] as const;
const RATE_LIMITS_QUERY_KEY = [...METADATA_QUERY_KEY, "rate-limits"] as const;
const HOOKS_QUERY_KEY = [...METADATA_QUERY_KEY, "hooks"] as const;

interface MetadataResourceData<T> {
  readonly value: T;
  readonly summary: string;
}

type MetadataResourceKind = "models" | "skills" | "permissionProfiles" | "rateLimits";

interface MetadataQueryData {
  readonly runtimeConfig: RuntimeConfigSnapshot;
  readonly models: MetadataResourceData<readonly ModelMetadata[]>;
  readonly skills: MetadataResourceData<readonly SkillMetadata[]>;
  readonly permissionProfiles: MetadataResourceData<readonly RuntimePermissionProfileSummary[]>;
  readonly rateLimits: MetadataResourceData<RateLimitSnapshot | null>;
}

type MetadataResourceDescriptor<Id extends SharedServerMetadataResourceId> = {
  readonly queryOptions: AppServerQueryOptions<MetadataQueryData[Id]>;
  readonly project: (result: QueryObserverResult<MetadataQueryData[Id]>) => SharedServerMetadataResourceFor<Id>;
  readonly snapshot: (data: MetadataQueryData[Id]) => SharedServerMetadataSnapshotValues[Id];
};

type MetadataResourceDescriptors = {
  readonly [Id in SharedServerMetadataResourceId]: MetadataResourceDescriptor<Id>;
};

export class AppServerMetadataQueries {
  private readonly metadataDescriptors: MetadataResourceDescriptors;
  private readonly hooksQueryOptions: AppServerQueryOptions<HookCatalog>;

  constructor(private readonly scope: AppServerQueryScope) {
    this.metadataDescriptors = this.createMetadataResourceDescriptors();
    this.hooksQueryOptions = {
      queryKey: HOOKS_QUERY_KEY,
      queryFn: () => this.scope.runWithClient((client) => listHookCatalog(client, this.scope.context.vaultPath)),
    };
  }

  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics {
    if (this.scope.isDisposed()) return createMetadataResourceDiagnostics();
    return {
      probes: {
        models: this.metadataProbe("models"),
        skills: this.metadataProbe("skills"),
        permissionProfiles: this.metadataProbe("permissionProfiles"),
        rateLimits: this.metadataProbe("rateLimits"),
      },
    };
  }

  metadataSnapshot<Id extends SharedServerMetadataResourceId>(id: Id): SharedServerMetadataSnapshotValues[Id] {
    if (this.scope.isDisposed()) return (id === "rateLimits" ? undefined : null) as SharedServerMetadataSnapshotValues[Id];
    const descriptor = this.metadataDescriptor(id);
    const data = this.scope.client.getQueryData<MetadataQueryData[Id]>(descriptor.queryOptions.queryKey);
    return data === undefined
      ? ((id === "rateLimits" ? undefined : null) as SharedServerMetadataSnapshotValues[Id])
      : descriptor.snapshot(data);
  }

  observeMetadataResource<Id extends SharedServerMetadataResourceId>(
    id: Id,
    listener: (resource: SharedServerMetadataResourceFor<Id>) => void,
    options: { emitCurrent?: boolean } = {},
  ): () => void {
    this.scope.assertUsable();
    const descriptor = this.metadataDescriptor(id);
    return this.observeMetadataQueryResource(descriptor.queryOptions, descriptor.project, listener, options);
  }

  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options: { emitCurrent?: boolean } = {}): () => void {
    this.scope.assertUsable();
    return this.scope.observeResult(
      this.metadataDescriptor("models").queryOptions,
      (data) => cloneModelMetadata(data.value),
      listener,
      options,
    );
  }

  observeHooksResult(listener: ObservedResultListener<HookCatalog>, options: { emitCurrent?: boolean } = {}): () => void {
    this.scope.assertUsable();
    return this.scope.observeResult(this.hooksQueryOptions, cloneHookCatalog, listener, options);
  }

  ensureAppServerMetadata(): Promise<void> {
    return this.loadAppServerMetadata();
  }

  async refreshAppServerMetadata(): Promise<void> {
    this.scope.assertUsable();
    await this.scope.client.invalidateQueries({ queryKey: METADATA_QUERY_KEY, refetchType: "none" });
    this.scope.assertUsable();
    await this.loadAppServerMetadata();
  }

  handleSkillsChanged(): void {
    this.revalidateUsedResource(this.metadataDescriptor("skills").queryOptions);
  }

  handleRateLimitsUpdated(): void {
    this.revalidateUsedResource(this.metadataDescriptor("rateLimits").queryOptions);
  }

  private async loadAppServerMetadata(): Promise<void> {
    this.scope.assertUsable();
    const [runtime] = await Promise.allSettled([
      this.fetchMetadataResource("runtimeConfig"),
      this.fetchMetadataResource("skills"),
      this.fetchMetadataResource("permissionProfiles"),
      this.fetchMetadataResource("rateLimits"),
      this.fetchModels(),
    ]);
    if (runtime.status === "rejected") throw runtime.reason;
  }

  async fetchModels(): Promise<readonly ModelMetadata[]> {
    this.scope.assertUsable();
    const descriptor = this.metadataDescriptor("models");
    const data = await this.scope.client.query(descriptor.queryOptions);
    return cloneModelMetadata(data.value);
  }

  async refreshModels(): Promise<readonly ModelMetadata[]> {
    const queryOptions = this.metadataDescriptor("models").queryOptions;
    await this.scope.client.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true, refetchType: "none" });
    this.scope.assertUsable();
    return this.fetchModels();
  }

  async refreshHooks(): Promise<void> {
    await this.scope.client.invalidateQueries({ queryKey: HOOKS_QUERY_KEY, exact: true, refetchType: "none" });
    this.scope.assertUsable();
    await this.scope.client.query(this.hooksQueryOptions);
  }

  trustHook(hook: HookItem): Promise<void> {
    return this.mutateHook(hook, trustHookItem);
  }

  setHookEnabled(hook: HookItem, enabled: boolean): Promise<void> {
    return this.mutateHook(hook, (client, item) => setHookItemEnabled(client, item, enabled));
  }

  private createMetadataResourceDescriptors(): MetadataResourceDescriptors {
    return {
      runtimeConfig: {
        queryOptions: {
          queryKey: RUNTIME_CONFIG_QUERY_KEY,
          queryFn: async (): Promise<RuntimeConfigSnapshot> =>
            this.scope.runWithClient(async (client) =>
              runtimeConfigSnapshotFromAppServerConfig(await readEffectiveConfig(client, this.scope.context.vaultPath)),
            ),
        },
        project: (result) => ({
          id: "runtimeConfig",
          value: result.data,
        }),
        snapshot: cloneRuntimeConfigSnapshot,
      },
      models: {
        queryOptions: {
          queryKey: MODELS_QUERY_KEY,
          queryFn: () =>
            this.readMetadataResource(async (client) => {
              const models = cloneModelMetadata(await listModelMetadata(client));
              return { value: models, summary: `${String(models.length)} models` };
            }),
        },
        project: (result) => ({
          id: "models",
          value: result.data?.value,
          probe: this.metadataProbe("models"),
        }),
        snapshot: (data) => cloneModelMetadata(data.value),
      },
      skills: {
        queryOptions: {
          queryKey: SKILLS_QUERY_KEY,
          queryFn: () =>
            this.readMetadataResource(async (client) => {
              const catalog = await listSkillCatalog(client, this.scope.context.vaultPath, {
                forceReload: false,
              });
              return { value: catalog.skills, summary: `${String(catalog.totalCount)} skills` };
            }),
        },
        project: (result) => ({
          id: "skills",
          value: result.data?.value,
          probe: this.metadataProbe("skills"),
        }),
        snapshot: (data) => data.value.map((skill) => ({ ...skill })),
      },
      permissionProfiles: {
        queryOptions: {
          queryKey: PERMISSION_PROFILES_QUERY_KEY,
          queryFn: () =>
            this.readMetadataResource(async (client) => {
              const profiles = await listPermissionProfiles(client, this.scope.context.vaultPath);
              return { value: profiles, summary: `${String(profiles.length)} profiles` };
            }),
        },
        project: (result) => ({
          id: "permissionProfiles",
          value: result.data?.value,
          probe: this.metadataProbe("permissionProfiles"),
        }),
        snapshot: (data) => data.value.map((profile) => ({ ...profile })),
      },
      rateLimits: {
        queryOptions: {
          queryKey: RATE_LIMITS_QUERY_KEY,
          queryFn: () =>
            this.readMetadataResource(async (client) => {
              const response = await readAccountRateLimits(client);
              return {
                value: rateLimitSnapshotFromAccountRateLimitsResponse(response),
                summary: accountRateLimitsSummaryFromResponse(response),
              };
            }),
        },
        project: (result) => ({
          id: "rateLimits",
          value: result.data?.value,
          probe: this.metadataProbe("rateLimits"),
        }),
        snapshot: (data) => (data.value ? cloneRateLimitSnapshot(data.value) : data.value),
      },
    };
  }

  private metadataDescriptor<Id extends SharedServerMetadataResourceId>(id: Id): MetadataResourceDescriptors[Id] {
    return this.metadataDescriptors[id];
  }

  private readMetadataResource<T>(
    read: (client: AppServerRequestClient) => Promise<{ value: T; summary: string }>,
  ): Promise<MetadataResourceData<T>> {
    return this.scope.runWithClient(read);
  }

  private async fetchMetadataResource<Id extends SharedServerMetadataResourceId>(id: Id): Promise<MetadataQueryData[Id]> {
    return this.scope.client.query(this.metadataDescriptor(id).queryOptions);
  }

  private revalidateUsedResource(queryOptions: AppServerQueryOptions<unknown>): void {
    if (this.scope.isDisposed()) return;
    if (!this.scope.client.getQueryState(queryOptions.queryKey)) return;
    void (async () => {
      await this.scope.client.cancelQueries({ queryKey: queryOptions.queryKey, exact: true });
      await this.scope.client.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true, refetchType: "none" });
      if (this.scope.isDisposed()) return;
      await this.scope.client.query(queryOptions);
    })().catch(() => {
      // The resource keeps its last-known-good value and exposes the failed probe to observers.
    });
  }

  private metadataProbe(resource: MetadataResourceKind): DiagnosticProbeResult {
    const key = this.metadataDescriptor(resource).queryOptions.queryKey;
    const state = this.scope.client.getQueryState<MetadataResourceData<unknown>>(key);
    if (state?.status === "error") return diagnosticProbeError(resource, state.error, state.errorUpdatedAt);
    if (state?.data) return diagnosticProbeOk(resource, state.data.summary, state.dataUpdatedAt);
    return createMetadataResourceDiagnostics().probes[resource];
  }

  private observeMetadataQueryResource<TQuery, Resource extends SharedServerMetadataResource>(
    queryOptions: AppServerQueryOptions<TQuery>,
    project: (result: QueryObserverResult<TQuery>) => Resource,
    listener: (resource: Resource) => void,
    options: { emitCurrent?: boolean },
  ): () => void {
    const observer = new QueryObserver<TQuery>(this.scope.client, {
      ...queryOptions,
      enabled: false,
    });
    const emit = (result: QueryObserverResult<TQuery>, includeFetching = false): void => {
      if (this.scope.isDisposed() || (result.isFetching && !includeFetching)) return;
      listener(cloneSharedServerMetadataResource(project(result)) as Resource);
    };
    const unsubscribe = observer.subscribe(emit);
    if (options.emitCurrent ?? true) emit(observer.getCurrentResult(), true);
    return this.scope.trackObserver(() => {
      unsubscribe();
      observer.destroy();
    });
  }

  private mutateHook(hook: HookItem, mutation: (client: AppServerRequestClient, hook: HookItem) => Promise<void>): Promise<void> {
    this.scope.assertUsable();
    return this.scope.runWithClient(async (client) => {
      await mutation(client, hook);
      await this.scope.client.invalidateQueries({ queryKey: HOOKS_QUERY_KEY, exact: true, refetchType: "none" });
      await this.scope.client.query({
        ...this.hooksQueryOptions,
        queryFn: () => listHookCatalog(client, this.scope.context.vaultPath),
      });
    });
  }
}

function cloneHookCatalog(catalog: HookCatalog): HookCatalog {
  return {
    hooks: catalog.hooks.map((hook: HookItem) => ({ ...hook })),
    warnings: [...catalog.warnings],
    errors: [...catalog.errors],
  };
}
