import { useLayoutEffect, useMemo, useReducer, useRef } from "preact/hooks";
import type { ModelMetadata, SkillMetadata } from "../../../../domain/runtime/catalog";
import {
  createMetadataResourceDiagnostics,
  type DiagnosticProbeResult,
  type MetadataResourceDiagnostics,
} from "../../../../domain/runtime/diagnostics";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/settings";
import type { McpServerRegistration, ToolInventorySnapshot } from "../../../../domain/runtime/tool-inventory";
import type { RateLimitSnapshot } from "../../../../domain/runtime/usage";
import { EMPTY_THREAD_ACTIVITY, type ObserveThreadListActivity } from "../../../../domain/threads/activity";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import type { Thread } from "../../../../domain/threads/model";
import type { ObservedPaginatedResult } from "../../../../shared/async/observed-result";
import type { ThreadCatalogPaginatedActiveReader } from "../../../threads/catalog/thread-catalog";
import type { ChatMetadataSource, ChatThreadGoalQueries, CodexChatHost } from "../contracts";

export function useArchiveBlockedThreadIds(observe: ObserveThreadListActivity): ReadonlySet<string> {
  return useObservedResource(observe, EMPTY_THREAD_ACTIVITY.archiveBlockedThreadIds, (update) =>
    observe(({ archiveBlockedThreadIds }) => {
      update(() => archiveBlockedThreadIds);
    }),
  );
}

export type ChatToolInventoryDisplayQueries = Pick<CodexChatHost["toolInventoryQueries"], "observe" | "observeMcpRegistrations">;

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

export function useRuntimeConfigResource(queries: ChatMetadataSource): RuntimeConfigSnapshot | null {
  return useObservedResource<RuntimeConfigSnapshot | null>(queries, null, (update) =>
    queries.observeMetadataResource("runtimeConfig", (resource) => {
      if (resource.value !== undefined) update(() => resource.value ?? null);
    }),
  );
}

export function useModelsResource(source: ChatMetadataSource): MetadataDisplayResource<readonly ModelMetadata[]> {
  return useObservedResource<MetadataDisplayResource<readonly ModelMetadata[]>>(
    source,
    { value: [], probe: INITIAL_METADATA_DIAGNOSTICS.probes.models },
    (update) =>
      source.observeMetadataResource("models", (resource) => {
        update(() => ({ value: resource.value ?? [], probe: resource.probe }));
      }),
  );
}

export function useSkillsResource(queries: ChatMetadataSource): MetadataDisplayResource<readonly SkillMetadata[]> {
  return useObservedResource(queries, INITIAL_SKILLS, (update) =>
    queries.observeMetadataResource("skills", (resource) => {
      update((current) => ({
        value: resource.value ?? current.value,
        probe: resource.probe,
      }));
    }),
  );
}

export function usePermissionProfilesProbe(queries: ChatMetadataSource): DiagnosticProbeResult {
  return useObservedResource(queries, INITIAL_METADATA_DIAGNOSTICS.probes.permissionProfiles, (update) =>
    queries.observeMetadataResource("permissionProfiles", (resource) => {
      update(() => resource.probe);
    }),
  );
}

export function useRateLimitsResource(queries: ChatMetadataSource): MetadataDisplayResource<RateLimitSnapshot | null> {
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

export function useMcpRegistrations(
  queries: ChatToolInventoryDisplayQueries,
  threadId: string | null,
): readonly McpServerRegistration[] | null {
  const source = useMemo(() => ({ queries, threadId }), [queries, threadId]);
  return useObservedResource<readonly McpServerRegistration[] | null>(source, null, (update) =>
    threadId === null
      ? () => undefined
      : queries.observeMcpRegistrations(threadId, (servers) => {
          update(() => servers);
        }),
  );
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
