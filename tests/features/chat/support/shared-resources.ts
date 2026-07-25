import { createMetadataResourceDiagnostics } from "../../../../src/domain/server/diagnostics";
import type { ChatSharedResources } from "../../../../src/features/chat/panel/shell/shared-resources";

export function chatSharedResourcesFixture(patch: Partial<ChatSharedResources> = {}): ChatSharedResources {
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
