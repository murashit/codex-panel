import { createMetadataResourceDiagnostics } from "../../../../src/domain/runtime/diagnostics";
import type { ChatPanelComposerSharedValues } from "../../../../src/features/chat/host/composer/view-projection";
import type { ChatPanelToolbarSharedValues } from "../../../../src/features/chat/host/toolbar/view-projection";

export function chatComposerSharedValuesFixture(patch: Partial<ChatPanelComposerSharedValues> = {}): ChatPanelComposerSharedValues {
  return {
    runtimeConfig: null,
    models: [],
    rateLimit: null,
    ...patch,
  };
}

export function chatToolbarSharedValuesFixture(patch: Partial<ChatPanelToolbarSharedValues> = {}): ChatPanelToolbarSharedValues {
  return {
    ...chatComposerSharedValuesFixture(),
    activeThreads: { threads: [], hasMore: false, isFetching: false, isFetchingNextPage: false, error: null },
    skills: [],
    metadataDiagnostics: createMetadataResourceDiagnostics(),
    toolInventory: null,
    ...patch,
  };
}
