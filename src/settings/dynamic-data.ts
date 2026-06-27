import type { HookItem, ModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import type { ObservedResultListener } from "../shared/query/observed-result";

export interface SettingsHookCatalog {
  hooks: readonly HookItem[];
  warnings: readonly string[];
  errors: readonly string[];
  status: string;
}

interface SettingsDynamicDataMutationOptions {
  shouldPublish?: () => boolean;
}

export interface SettingsDynamicDataAccess {
  modelsSnapshot(): readonly ModelMetadata[] | null;
  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
  archivedThreadsSnapshot(): readonly Thread[] | null;
  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  loadHooks(): Promise<SettingsHookCatalog>;
  trustHook(hook: HookItem): Promise<void>;
  setHookEnabled(hook: HookItem, enabled: boolean): Promise<void>;
  restoreArchivedThread(threadId: string, options?: SettingsDynamicDataMutationOptions): Promise<Thread>;
  deleteArchivedThread(threadId: string, options?: SettingsDynamicDataMutationOptions): Promise<void>;
  notifyContextChanged(): void;
}

export class StaleSettingsDynamicDataContextError extends Error {
  constructor() {
    super("Settings dynamic data context changed while loading Codex details.");
    this.name = "StaleSettingsDynamicDataContextError";
  }
}

export function isStaleSettingsDynamicDataContextError(error: unknown): error is StaleSettingsDynamicDataContextError {
  return error instanceof StaleSettingsDynamicDataContextError;
}
