import type { HookCatalog, HookItem, ModelMetadata } from "../../domain/runtime/catalog";
import type { ThreadCatalogArchivedReader } from "../../features/threads/catalog/thread-catalog";
import type { ThreadMutationCommands } from "../../features/threads/workflows/thread-mutation-commands";
import type { ResultObservation } from "../../shared/async/observed-result";

export interface SettingsResources {
  readonly queries: SettingsResourceQueries;
  readonly threadCatalog: ThreadCatalogArchivedReader;
  readonly threadMutations: Pick<ThreadMutationCommands, "restoreThread" | "deleteThread">;
}

interface SettingsResourceQueries {
  watchModels(changed: () => void): ResultObservation<readonly ModelMetadata[]>;
  watchHooks(changed: () => void): ResultObservation<HookCatalog>;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
  refreshHooks(): Promise<void>;
  trustHook(hook: HookItem): Promise<void>;
  setHookEnabled(hook: HookItem, enabled: boolean): Promise<void>;
}
