import type { AppServerClient } from "../app-server/connection/client";
import type { AppServerClientAccess } from "../app-server/connection/client-access";
import { listHookCatalog, setHookItemEnabled, trustHookItem } from "../app-server/services/catalog";
import type { HookItem, ModelMetadata } from "../domain/catalog/metadata";
import type { ThreadCatalogArchivedReader } from "../features/threads/catalog/thread-catalog";
import type { ThreadMutationCommands } from "../features/threads/workflows/thread-mutation-commands";
import type { ObservedResultListener } from "../shared/runtime/observed-result";
import type { SettingsDynamicDataAccess, SettingsHookCatalog } from "./dynamic-data";

interface SettingsAppServerQueries {
  metadataSnapshot(id: "models"): readonly ModelMetadata[] | null;
  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
}

export interface SettingsAppServerDynamicDataOptions {
  vaultPath: string;
  clientAccess: AppServerClientAccess;
  appServerQueries: SettingsAppServerQueries;
  threadCatalog: ThreadCatalogArchivedReader;
  threadMutations: Pick<ThreadMutationCommands, "restoreThread" | "deleteThread">;
}

export function createSettingsAppServerDynamicData(options: SettingsAppServerDynamicDataOptions): SettingsDynamicDataAccess {
  const withSettingsConnection = <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> =>
    options.clientAccess.withClient(operation, {
      serverRequests: { kind: "reject", message: "Codex Panel settings does not handle server requests." },
    });
  const loadHooks = (client: AppServerClient): Promise<SettingsHookCatalog> => loadSettingsHookCatalog(client, options.vaultPath);
  const mutateHook = (hook: HookItem, mutation: (client: AppServerClient, hook: HookItem) => Promise<void>): Promise<SettingsHookCatalog> =>
    withSettingsConnection(async (client) => {
      await mutation(client, hook);
      return loadHooks(client);
    });

  return {
    modelsSnapshot: () => options.appServerQueries.metadataSnapshot("models"),
    observeModelsResult: (listener, observeOptions) => options.appServerQueries.observeModelsResult(listener, observeOptions),
    fetchModels: () => options.appServerQueries.fetchModels(),
    refreshModels: () => options.appServerQueries.refreshModels(),
    archivedThreadsSnapshot: () => options.threadCatalog.archivedThreadsSnapshot(),
    observeArchivedThreadsResult: (listener, observeOptions) =>
      options.threadCatalog.observeArchivedThreadsResult(listener, observeOptions),
    refreshArchivedThreads: () => options.threadCatalog.refreshArchivedThreads(),
    refreshHooks: () => withSettingsConnection(loadHooks),
    trustHook: (hook) => mutateHook(hook, trustHookItem),
    setHookEnabled: (hook, enabled) => mutateHook(hook, (client, item) => setHookItemEnabled(client, item, enabled)),
    restoreArchivedThread: (threadId) => options.threadMutations.restoreThread(threadId),
    deleteArchivedThread: (threadId) => options.threadMutations.deleteThread(threadId),
  };
}

async function loadSettingsHookCatalog(client: AppServerClient, vaultPath: string): Promise<SettingsHookCatalog> {
  const catalog = await listHookCatalog(client, vaultPath);
  const hookCount = catalog.hooks.length;
  return {
    ...catalog,
    status: `Loaded ${String(hookCount)} hook${hookCount === 1 ? "" : "s"}.`,
  };
}
