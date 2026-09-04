import type { HookCatalog, HookItem, ModelMetadata } from "../../domain/catalog/metadata";
import type { ThreadCatalogArchivedReader } from "../../features/threads/catalog/thread-catalog";
import type { ThreadMutationCommands } from "../../features/threads/workflows/thread-mutation-commands";
import type { ObservedResultListener } from "../../shared/async/observed-result";

export type SettingsHookCatalog = HookCatalog;

export interface SettingsResources {
  readonly queries: SettingsResourceQueries;
  readonly threadCatalog: ThreadCatalogArchivedReader;
  readonly threadMutations: Pick<ThreadMutationCommands, "restoreThread" | "deleteThread">;
}

interface SettingsResourceQueries {
  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
  observeHooksResult(listener: ObservedResultListener<SettingsHookCatalog>, options?: { emitCurrent?: boolean }): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
  refreshHooks(): Promise<void>;
  trustHook(hook: HookItem): Promise<void>;
  setHookEnabled(hook: HookItem, enabled: boolean): Promise<void>;
}
