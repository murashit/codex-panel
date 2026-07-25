import { useLayoutEffect, useReducer, useRef } from "preact/hooks";
import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../domain/runtime/metrics";
import { createMetadataResourceDiagnostics, type MetadataResourceDiagnostics } from "../../../../domain/server/diagnostics";
import type { SharedServerMetadataResource } from "../../../../domain/server/metadata";
import type { Thread } from "../../../../domain/threads/model";
import type { ObservedPaginatedResult } from "../../../../shared/runtime/observed-result";
import type { ThreadCatalogPaginatedActiveReader } from "../../../threads/catalog/thread-catalog";

export interface ChatSharedResourceQueries {
  observeAppServerMetadataResources(
    listener: (resource: SharedServerMetadataResource) => void,
    options?: { emitCurrent?: boolean },
  ): () => void;
}

export interface ChatSharedResources {
  readonly threads: readonly Thread[];
  readonly hasMoreThreads: boolean;
  readonly threadListFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly threadListError: string | null;
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly availableModels: readonly ModelMetadata[];
  readonly availableSkills: readonly SkillMetadata[];
  readonly rateLimit: RateLimitSnapshot | null;
  readonly metadataDiagnostics: MetadataResourceDiagnostics;
}

const INITIAL_SHARED_RESOURCES: ChatSharedResources = {
  threads: [],
  hasMoreThreads: false,
  threadListFetching: false,
  isFetchingNextPage: false,
  threadListError: null,
  runtimeConfig: null,
  availableModels: [],
  availableSkills: [],
  rateLimit: null,
  metadataDiagnostics: createMetadataResourceDiagnostics(),
};

export function useChatSharedResources(
  queries: ChatSharedResourceQueries,
  threadCatalog: ThreadCatalogPaginatedActiveReader,
): ChatSharedResources {
  const snapshotRef = useRef<ChatSharedResources>(INITIAL_SHARED_RESOURCES);
  const sourcesRef = useRef({ queries, threadCatalog });
  const [, rerender] = useReducer((version: number) => version + 1, 0);
  if (sourcesRef.current.queries !== queries || sourcesRef.current.threadCatalog !== threadCatalog) {
    sourcesRef.current = { queries, threadCatalog };
    snapshotRef.current = INITIAL_SHARED_RESOURCES;
  }

  useLayoutEffect(() => {
    let active = true;
    const update = (next: ChatSharedResources): void => {
      if (!active || sharedResourcesEqual(snapshotRef.current, next)) return;
      snapshotRef.current = next;
      rerender(undefined);
    };
    const receiveThreads = (result: ObservedPaginatedResult<readonly Thread[]>): void => {
      update({
        ...snapshotRef.current,
        threads: result.value ?? [],
        hasMoreThreads: result.hasMore,
        threadListFetching: result.isFetching,
        isFetchingNextPage: result.isFetchingNextPage,
        threadListError: result.error?.message ?? null,
      });
    };
    const unsubscribeThreads = threadCatalog.observeActiveThreadsResult(receiveThreads);
    const unsubscribeMetadata = queries.observeAppServerMetadataResources((resource) => {
      const current = snapshotRef.current;
      if (resource.id === "runtimeConfig") {
        if (resource.value) update({ ...current, runtimeConfig: resource.value });
        return;
      }
      const metadataDiagnostics: MetadataResourceDiagnostics = {
        probes: {
          ...current.metadataDiagnostics.probes,
          [resource.id]: resource.probe,
        },
      };
      switch (resource.id) {
        case "models":
          update({
            ...current,
            ...(resource.value === undefined ? {} : { availableModels: resource.value }),
            metadataDiagnostics,
          });
          return;
        case "skills":
          update({
            ...current,
            ...(resource.value === undefined ? {} : { availableSkills: resource.value }),
            metadataDiagnostics,
          });
          return;
        case "permissionProfiles":
          update({
            ...current,
            metadataDiagnostics,
          });
          return;
        case "rateLimits":
          update({
            ...current,
            ...(resource.value === undefined ? {} : { rateLimit: resource.value }),
            metadataDiagnostics,
          });
          return;
      }
    });
    return () => {
      active = false;
      unsubscribeThreads();
      unsubscribeMetadata();
    };
  }, [queries, threadCatalog]);

  return snapshotRef.current;
}

function sharedResourcesEqual(left: ChatSharedResources, right: ChatSharedResources): boolean {
  return (
    left.threads === right.threads &&
    left.hasMoreThreads === right.hasMoreThreads &&
    left.threadListFetching === right.threadListFetching &&
    left.isFetchingNextPage === right.isFetchingNextPage &&
    left.threadListError === right.threadListError &&
    left.runtimeConfig === right.runtimeConfig &&
    left.availableModels === right.availableModels &&
    left.availableSkills === right.availableSkills &&
    left.rateLimit === right.rateLimit &&
    left.metadataDiagnostics === right.metadataDiagnostics
  );
}
