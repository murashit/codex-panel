import type { ModelMetadata, SkillMetadata } from "../../../../src/domain/runtime/catalog";
import type { MetadataResourceDiagnostics } from "../../../../src/domain/runtime/diagnostics";
import { createMetadataResourceDiagnostics } from "../../../../src/domain/runtime/diagnostics";
import type { RuntimeConfigSnapshot } from "../../../../src/domain/runtime/settings";
import type { ToolInventorySnapshot } from "../../../../src/domain/runtime/tool-inventory";
import type { RateLimitSnapshot } from "../../../../src/domain/runtime/usage";
import type { Thread } from "../../../../src/domain/threads/model";
import type { ChatPanelComposerSharedValues } from "../../../../src/features/chat/host/composer/view-projection";
import type { ChatPanelThreadStreamSharedValues } from "../../../../src/features/chat/host/thread-stream/view-projection";
import type { ChatPanelToolbarSharedValues } from "../../../../src/features/chat/host/toolbar/view-projection";

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
  readonly toolInventory: ToolInventorySnapshot | null;
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
    toolInventory: null,
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
    toolInventory: shared.toolInventory,
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
