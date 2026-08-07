import { QueryObserver, type QueryObserverResult } from "@tanstack/query-core";
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
import { runtimeConfigSnapshotFromAppServerConfig } from "../protocol/runtime-config";
import { listModelMetadata } from "../services/catalog";
import { readPermissionProfileMetadataProbe, readRateLimitMetadataProbe, readSkillMetadataProbe } from "../services/metadata-probes";
import { readEffectiveConfig } from "../services/runtime-metadata";
import { createInvalidatedQueryRefreshCoordinator, type InvalidatedQueryRefreshCoordinator } from "./invalidated-query-refresh";
import type { AppServerQueryOptions, AppServerQueryScope } from "./query-scope";
import { cloneModelMetadata, cloneRateLimitSnapshot, cloneSharedServerMetadataResource } from "./snapshots";

const MODELS_STALE_TIME_MS = 60_000;
const MODELS_QUERY_KEY = ["models"] as const;
const RUNTIME_CONFIG_QUERY_KEY = ["runtime-config"] as const;
const SKILLS_QUERY_KEY = ["skills"] as const;
const PERMISSION_PROFILES_QUERY_KEY = ["permission-profiles"] as const;
const RATE_LIMITS_QUERY_KEY = ["rate-limits"] as const;

interface MetadataResourceSnapshot<T> {
  readonly value: T;
  readonly probe: DiagnosticProbeResult;
}

type MetadataResourceKind = "skills" | "permissionProfiles" | "rateLimits";
type MetadataResourceValue = readonly SkillMetadata[] | readonly RuntimePermissionProfileSummary[] | RateLimitSnapshot | null;

interface MetadataResourceQueryOptions {
  readonly forceReloadSkills?: boolean;
}

interface MetadataQueryData {
  readonly runtimeConfig: RuntimeConfigSnapshot;
  readonly models: readonly ModelMetadata[];
  readonly skills: MetadataResourceSnapshot<readonly SkillMetadata[]>;
  readonly permissionProfiles: MetadataResourceSnapshot<readonly RuntimePermissionProfileSummary[]>;
  readonly rateLimits: MetadataResourceSnapshot<RateLimitSnapshot | null>;
}

interface InvalidatedMetadataQueries {
  readonly skills: MetadataQueryData["skills"];
  readonly rateLimits: MetadataQueryData["rateLimits"];
}

type InvalidatedMetadataResourceKind = keyof InvalidatedMetadataQueries;

type MetadataResourceDescriptor<Id extends SharedServerMetadataResourceId> = {
  readonly queryOptions: (options?: MetadataResourceQueryOptions) => AppServerQueryOptions<MetadataQueryData[Id]>;
  readonly project: (result: QueryObserverResult<MetadataQueryData[Id]>) => SharedServerMetadataResourceFor<Id>;
  readonly snapshot: (data: MetadataQueryData[Id]) => SharedServerMetadataSnapshotValues[Id];
};

type MetadataResourceDescriptors = {
  readonly [Id in SharedServerMetadataResourceId]: MetadataResourceDescriptor<Id>;
};

export class AppServerMetadataQueries {
  private readonly metadataDescriptors: MetadataResourceDescriptors;
  private readonly invalidatedMetadataQueries: InvalidatedQueryRefreshCoordinator<InvalidatedMetadataQueries>;

  constructor(private readonly scope: AppServerQueryScope) {
    this.metadataDescriptors = this.createMetadataResourceDescriptors();
    this.invalidatedMetadataQueries = createInvalidatedQueryRefreshCoordinator<InvalidatedMetadataQueries>({
      client: scope.client,
      queryOptions: (id, cause) =>
        this.metadataDescriptor(id).queryOptions({
          forceReloadSkills: id === "skills" && cause === "refresh",
        }),
    });
  }

  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics {
    if (this.scope.isDisposed()) return createMetadataResourceDiagnostics();
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
    if (this.scope.isDisposed()) return (id === "rateLimits" ? undefined : null) as SharedServerMetadataSnapshotValues[Id];
    const descriptor = this.metadataDescriptor(id);
    const data = this.scope.client.getQueryData<MetadataQueryData[Id]>(descriptor.queryOptions().queryKey);
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
    return this.observeMetadataQueryResource(descriptor.queryOptions(), descriptor.project, listener, options);
  }

  async refreshAppServerMetadata(): Promise<void> {
    this.scope.assertUsable();
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
    if (!runtime.ok) throw runtime.error;
  }

  refreshSkills(): Promise<void> {
    this.scope.assertUsable();
    return this.invalidatedMetadataQueries.refreshAfterInvalidation("skills");
  }

  refreshRateLimits(): Promise<void> {
    this.scope.assertUsable();
    return this.invalidatedMetadataQueries.refreshAfterInvalidation("rateLimits");
  }

  async fetchModels(options: { force?: boolean } = {}): Promise<readonly ModelMetadata[]> {
    this.scope.assertUsable();
    const descriptor = this.metadataDescriptor("models");
    const key = descriptor.queryOptions().queryKey;
    if (options.force) {
      await this.scope.client.invalidateQueries({ queryKey: key, refetchType: "none" });
      this.scope.assertUsable();
    }
    const models = await this.scope.client.fetchQuery(descriptor.queryOptions());
    return cloneModelMetadata(models);
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
            this.scope.runWithClient(async (client) =>
              runtimeConfigSnapshotFromAppServerConfig(await readEffectiveConfig(client, this.scope.context.vaultPath)),
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
              return cloneModelMetadata(await this.scope.runWithClient((client) => listModelMetadata(client)));
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
        queryOptions: (options = {}) => ({
          queryKey: SKILLS_QUERY_KEY,
          queryFn: async () =>
            this.scope.runWithClient(async (client) =>
              successfulMetadataResource(
                await readSkillMetadataProbe(client, this.scope.context.vaultPath, {
                  forceReload: options.forceReloadSkills ?? false,
                }),
              ),
            ),
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
            this.scope.runWithClient(async (client) =>
              successfulMetadataResource(await readPermissionProfileMetadataProbe(client, this.scope.context.vaultPath)),
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
          queryFn: async () =>
            this.scope.runWithClient(async (client) => successfulMetadataResource(await readRateLimitMetadataProbe(client))),
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

  private async fetchRuntimeConfig(): Promise<void> {
    await this.fetchMetadataResource("runtimeConfig");
  }

  private async fetchMetadataResource<Id extends SharedServerMetadataResourceId>(id: Id): Promise<MetadataQueryData[Id]> {
    const data = isInvalidatedMetadataResource(id)
      ? await this.invalidatedMetadataQueries.read(id)
      : await this.scope.client.fetchQuery(this.metadataDescriptor(id).queryOptions());
    return data as MetadataQueryData[Id];
  }

  private metadataResourceState(resource: "skills"): { value: readonly SkillMetadata[] | null; probe: DiagnosticProbeResult };
  private metadataResourceState(resource: "permissionProfiles"): {
    value: readonly RuntimePermissionProfileSummary[] | null;
    probe: DiagnosticProbeResult;
  };
  private metadataResourceState(resource: "rateLimits"): { value: RateLimitSnapshot | null; probe: DiagnosticProbeResult };
  private metadataResourceState(resource: MetadataResourceKind): { value: MetadataResourceValue; probe: DiagnosticProbeResult } {
    const key = this.metadataDescriptor(resource).queryOptions().queryKey;
    const state = this.scope.client.getQueryState<MetadataResourceSnapshot<MetadataResourceValue>>(key);
    const failedProbe = diagnosticProbeFromError(state?.error);
    return {
      value: state?.data?.value ?? null,
      probe: failedProbe ?? state?.data?.probe ?? createServerDiagnostics().probes[resource],
    };
  }

  private modelsProbe(): DiagnosticProbeResult {
    const state = this.scope.client.getQueryState<readonly ModelMetadata[]>(this.metadataDescriptor("models").queryOptions().queryKey);
    return (
      diagnosticProbeFromError(state?.error) ??
      (state?.data
        ? diagnosticProbeOk("models", `${String(state.data.length)} models`, state.dataUpdatedAt)
        : createServerDiagnostics().probes.models)
    );
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

function isInvalidatedMetadataResource(id: SharedServerMetadataResourceId): id is InvalidatedMetadataResourceKind {
  return id === "skills" || id === "rateLimits";
}

function diagnosticProbeFromError(error: unknown): DiagnosticProbeResult | null {
  return error instanceof MetadataResourceQueryError ? error.probe : null;
}
