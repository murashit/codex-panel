import type { AppServerClient } from "../app-server/connection/client";
import type { AppServerClientAccess } from "../app-server/connection/client-access";
import type { ObservedResultListener } from "../app-server/query/observed-result";
import { isStaleAppServerResourceContextError } from "../app-server/query/resource-store";
import { listHookCatalog, setHookItemEnabled, trustHookItem } from "../app-server/services/catalog";
import { deleteThread, restoreArchivedThread as restoreArchivedThreadOnAppServer } from "../app-server/services/threads";
import type { ModelMetadata } from "../domain/catalog/metadata";
import type { ThreadCatalogArchivedReader, ThreadCatalogEventSink } from "../features/threads/catalog/thread-catalog";
import { type SettingsDynamicDataAccess, type SettingsHookCatalog, StaleSettingsDynamicDataContextError } from "./dynamic-data";

interface SettingsAppServerQueries {
  modelsSnapshot(): readonly ModelMetadata[] | null;
  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
}

type SettingsArchivedThreadCatalog = ThreadCatalogArchivedReader & ThreadCatalogEventSink;

export interface SettingsAppServerDynamicDataOptions {
  vaultPath: string;
  clientAccess: AppServerClientAccess;
  appServerQueries: SettingsAppServerQueries;
  threadCatalog: SettingsArchivedThreadCatalog;
}

export function createSettingsAppServerDynamicData(options: SettingsAppServerDynamicDataOptions): SettingsDynamicDataAccess {
  const withSettingsConnection = <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> =>
    options.clientAccess.withClient(operation, {
      serverRequests: { kind: "reject", message: "Codex Panel settings does not handle server requests." },
    });

  return {
    modelsSnapshot: () => options.appServerQueries.modelsSnapshot(),
    observeModelsResult: (listener, observeOptions) => options.appServerQueries.observeModelsResult(listener, observeOptions),
    fetchModels: () => mapStaleContextError(() => options.appServerQueries.fetchModels()),
    refreshModels: () => mapStaleContextError(() => options.appServerQueries.refreshModels()),
    archivedThreadsSnapshot: () => options.threadCatalog.archivedSnapshot(),
    observeArchivedThreadsResult: (listener, observeOptions) => options.threadCatalog.observeArchived(listener, observeOptions),
    refreshArchivedThreads: () => mapStaleContextError(() => options.threadCatalog.refreshArchived()),
    loadHooks: () => withSettingsConnection((client) => loadSettingsHookCatalog(client, options.vaultPath)),
    trustHook: (hook) => withSettingsConnection((client) => trustHookItem(client, hook)),
    setHookEnabled: (hook, enabled) => withSettingsConnection((client) => setHookItemEnabled(client, hook, enabled)),
    restoreArchivedThread: async (threadId, mutationOptions) => {
      const thread = await withSettingsConnection((client) => restoreArchivedThreadOnAppServer(client, threadId));
      if (mutationOptions?.shouldPublish?.() ?? true) {
        options.threadCatalog.apply({ type: "thread-restored", thread });
      }
      return thread;
    },
    deleteArchivedThread: async (threadId, mutationOptions) => {
      await withSettingsConnection((client) => deleteThread(client, threadId));
      if (mutationOptions?.shouldPublish?.() ?? true) {
        options.threadCatalog.apply({ type: "thread-deleted", threadId });
      }
    },
  };
}

async function loadSettingsHookCatalog(client: AppServerClient, cwd: string): Promise<SettingsHookCatalog> {
  const hooks = await listHookCatalog(client, cwd);
  const hookCount = hooks.hooks.length;
  return {
    ...hooks,
    status: `Loaded ${String(hookCount)} hook${hookCount === 1 ? "" : "s"}.`,
  };
}

async function mapStaleContextError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isStaleAppServerResourceContextError(error)) throw new StaleSettingsDynamicDataContextError();
    throw error;
  }
}
