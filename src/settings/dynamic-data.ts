import type { ObservedResultListener } from "../app-server/query/observed-result";
import type { HookItem, ModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";

export interface SettingsHookCatalog {
  hooks: readonly HookItem[];
  warnings: readonly string[];
  errors: readonly string[];
  status: string;
}

export interface SettingsDynamicDataAccess {
  modelsSnapshot(): readonly ModelMetadata[] | null;
  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
  archivedThreadsSnapshot(): readonly Thread[] | null;
  observeArchivedThreadsResult(listener: ObservedResultListener<readonly Thread[]>, options?: { emitCurrent?: boolean }): () => void;
  refreshArchivedThreads(): Promise<readonly Thread[]>;
  refreshHooks(): Promise<SettingsHookCatalog>;
  trustHook(hook: HookItem): Promise<SettingsHookCatalog>;
  setHookEnabled(hook: HookItem, enabled: boolean): Promise<SettingsHookCatalog>;
  restoreArchivedThread(threadId: string): Promise<Thread>;
  deleteArchivedThread(threadId: string): Promise<void>;
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
