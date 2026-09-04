import { useLayoutEffect, useMemo, useReducer, useRef } from "preact/hooks";
import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../domain/runtime/metrics";
import {
  createMetadataResourceDiagnostics,
  type DiagnosticProbeResult,
  type MetadataResourceDiagnostics,
} from "../../../../domain/server/diagnostics";
import type { SharedServerMetadataResourceFor, SharedServerMetadataResourceId } from "../../../../domain/server/metadata";
import type { ToolInventorySnapshot } from "../../../../domain/server/tool-inventory";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import type { Thread } from "../../../../domain/threads/model";
import type { ObservedPaginatedResult } from "../../../../shared/async/observed-result";
import type { ThreadCatalogPaginatedActiveReader } from "../../../threads/catalog/thread-catalog";
import type { ChatThreadGoalQueries } from "../contracts";

export interface ChatSharedDisplayQueries {
  observeMetadataResource<Id extends SharedServerMetadataResourceId>(
    id: Id,
    listener: (resource: SharedServerMetadataResourceFor<Id>) => void,
  ): () => void;
}

export interface ChatToolInventoryDisplayQueries {
  observe(threadId: string | null, listener: (snapshot: ToolInventorySnapshot | null) => void): () => void;
}

export interface ActiveThreadsDisplayResource {
  readonly threads: readonly Thread[];
  readonly hasMore: boolean;
  readonly isFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly error: string | null;
}

export interface MetadataDisplayResource<Value> {
  readonly value: Value;
  readonly probe: DiagnosticProbeResult;
}

const INITIAL_ACTIVE_THREADS: ActiveThreadsDisplayResource = {
  threads: [],
  hasMore: false,
  isFetching: false,
  isFetchingNextPage: false,
  error: null,
};

const INITIAL_METADATA_DIAGNOSTICS = createMetadataResourceDiagnostics();
const INITIAL_MODELS: MetadataDisplayResource<readonly ModelMetadata[]> = {
  value: [],
  probe: INITIAL_METADATA_DIAGNOSTICS.probes.models,
};
const INITIAL_SKILLS: MetadataDisplayResource<readonly SkillMetadata[]> = {
  value: [],
  probe: INITIAL_METADATA_DIAGNOSTICS.probes.skills,
};
const INITIAL_RATE_LIMITS: MetadataDisplayResource<RateLimitSnapshot | null> = {
  value: null,
  probe: INITIAL_METADATA_DIAGNOSTICS.probes.rateLimits,
};

export function useActiveThreadsResource(threadCatalog: ThreadCatalogPaginatedActiveReader): ActiveThreadsDisplayResource {
  return useObservedResource(threadCatalog, INITIAL_ACTIVE_THREADS, (update) =>
    threadCatalog.observeActiveThreadsResult((result) => {
      update((current) => activeThreadsDisplayResource(result, current));
    }),
  );
}

export function useRuntimeConfigResource(queries: ChatSharedDisplayQueries): RuntimeConfigSnapshot | null {
  return useObservedResource<RuntimeConfigSnapshot | null>(queries, null, (update) =>
    queries.observeMetadataResource("runtimeConfig", (resource) => {
      if (resource.value !== undefined) update(() => resource.value ?? null);
    }),
  );
}

export function useModelsResource(queries: ChatSharedDisplayQueries): MetadataDisplayResource<readonly ModelMetadata[]> {
  return useObservedResource(queries, INITIAL_MODELS, (update) =>
    queries.observeMetadataResource("models", (resource) => {
      update((current) => ({
        value: resource.value ?? current.value,
        probe: resource.probe,
      }));
    }),
  );
}

export function useSkillsResource(queries: ChatSharedDisplayQueries): MetadataDisplayResource<readonly SkillMetadata[]> {
  return useObservedResource(queries, INITIAL_SKILLS, (update) =>
    queries.observeMetadataResource("skills", (resource) => {
      update((current) => ({
        value: resource.value ?? current.value,
        probe: resource.probe,
      }));
    }),
  );
}

export function usePermissionProfilesProbe(queries: ChatSharedDisplayQueries): DiagnosticProbeResult {
  return useObservedResource(queries, INITIAL_METADATA_DIAGNOSTICS.probes.permissionProfiles, (update) =>
    queries.observeMetadataResource("permissionProfiles", (resource) => {
      update(() => resource.probe);
    }),
  );
}

export function useRateLimitsResource(queries: ChatSharedDisplayQueries): MetadataDisplayResource<RateLimitSnapshot | null> {
  return useObservedResource(queries, INITIAL_RATE_LIMITS, (update) =>
    queries.observeMetadataResource("rateLimits", (resource) => {
      update((current) => ({
        value: resource.value === undefined ? current.value : resource.value,
        probe: resource.probe,
      }));
    }),
  );
}

export function useToolInventoryResource(
  queries: ChatToolInventoryDisplayQueries,
  threadId: string | null,
  enabled = true,
): ToolInventorySnapshot | null {
  const source = useMemo(() => ({ queries, threadId, enabled }), [queries, threadId, enabled]);
  return useObservedResource<ToolInventorySnapshot | null>(source, null, (update) => {
    if (!enabled) return () => undefined;
    return queries.observe(threadId, (snapshot) => {
      update(() => snapshot);
    });
  });
}

export interface ThreadGoalDisplayResource {
  readonly goal: ThreadGoal | null;
  readonly error: string | null;
}

const INITIAL_THREAD_GOAL: ThreadGoalDisplayResource = { goal: null, error: null };

export function useThreadGoalResource(queries: ChatThreadGoalQueries, threadId: string | null, enabled = true): ThreadGoalDisplayResource {
  const source = useMemo(() => ({ queries, threadId, enabled }), [queries, threadId, enabled]);
  return useObservedResource<ThreadGoalDisplayResource>(source, INITIAL_THREAD_GOAL, (update) => {
    if (!threadId || !enabled) return () => undefined;
    return queries.observe(threadId, (goal, error) => {
      update(() => ({ goal, error }));
    });
  });
}

export function metadataDiagnosticsFromResources(input: {
  readonly models: MetadataDisplayResource<readonly ModelMetadata[]>;
  readonly skills: MetadataDisplayResource<readonly SkillMetadata[]>;
  readonly permissionProfilesProbe: DiagnosticProbeResult;
  readonly rateLimits: MetadataDisplayResource<RateLimitSnapshot | null>;
}): MetadataResourceDiagnostics {
  return {
    probes: {
      models: input.models.probe,
      skills: input.skills.probe,
      permissionProfiles: input.permissionProfilesProbe,
      rateLimits: input.rateLimits.probe,
    },
  };
}

type ResourceUpdate<Value> = (current: Value) => Value;

function useObservedResource<Value>(
  source: object,
  initialValue: Value,
  subscribe: (update: (update: ResourceUpdate<Value>) => void) => () => void,
): Value {
  const stateRef = useRef<{ source: object; value: Value }>({ source, value: initialValue });
  const subscribeRef = useRef(subscribe);
  const [, rerender] = useReducer((version: number) => version + 1, 0);
  subscribeRef.current = subscribe;
  if (stateRef.current.source !== source) stateRef.current = { source, value: initialValue };

  useLayoutEffect(() => {
    let active = true;
    const unsubscribe = subscribeRef.current((update) => {
      if (!active || stateRef.current.source !== source) return;
      const value = update(stateRef.current.value);
      if (Object.is(stateRef.current.value, value)) return;
      stateRef.current = { source, value };
      rerender(undefined);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [source]);

  return stateRef.current.value;
}

function activeThreadsDisplayResource(
  result: ObservedPaginatedResult<readonly Thread[]>,
  current: ActiveThreadsDisplayResource,
): ActiveThreadsDisplayResource {
  return {
    threads: result.value ?? current.threads,
    hasMore: result.hasMore,
    isFetching: result.isFetching,
    isFetchingNextPage: result.isFetchingNextPage,
    error: result.error?.message ?? null,
  };
}
