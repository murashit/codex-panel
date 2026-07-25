import type { ModelMetadata, SkillMetadata } from "../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../src/domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../src/domain/runtime/metrics";
import type { MetadataResourceDiagnostics } from "../../../../src/domain/server/diagnostics";
import { createMetadataResourceDiagnostics } from "../../../../src/domain/server/diagnostics";
import type { Thread } from "../../../../src/domain/threads/model";
import type {
  ChatPanelComposerSharedValues,
  ChatPanelThreadStreamSharedValues,
  ChatPanelToolbarSharedValues,
} from "../../../../src/features/chat/panel/shell/selectors";

export interface ChatSharedDisplayValues {
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

export function chatSharedResourcesFixture(patch: Partial<ChatSharedDisplayValues> = {}): ChatSharedDisplayValues {
  return {
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
    ...patch,
  };
}

export function toolbarSharedValues(shared: ChatSharedDisplayValues): ChatPanelToolbarSharedValues {
  return {
    activeThreads: {
      threads: shared.threads,
      hasMore: shared.hasMoreThreads,
      isFetching: shared.threadListFetching,
      isFetchingNextPage: shared.isFetchingNextPage,
      error: shared.threadListError,
    },
    runtimeConfig: shared.runtimeConfig,
    models: shared.availableModels,
    skills: shared.availableSkills,
    rateLimit: shared.rateLimit,
    metadataDiagnostics: shared.metadataDiagnostics,
  };
}

export function threadStreamSharedValues(shared: ChatSharedDisplayValues): ChatPanelThreadStreamSharedValues {
  return { threads: shared.threads };
}

export function composerSharedValues(shared: ChatSharedDisplayValues): ChatPanelComposerSharedValues {
  return {
    threads: shared.threads,
    runtimeConfig: shared.runtimeConfig,
    models: shared.availableModels,
    rateLimit: shared.rateLimit,
  };
}
