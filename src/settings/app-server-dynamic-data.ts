import type { AppServerClient } from "../app-server/connection/client";
import type { AppServerClientAccess } from "../app-server/connection/client-access";
import type { ObservedResultListener } from "../app-server/query/observed-result";
import { isStaleAppServerResourceContextError } from "../app-server/query/resource-store";
import { listHookCatalog, setHookItemEnabled, trustHookItem } from "../app-server/services/catalog";
import { deleteThread, restoreArchivedThread as restoreArchivedThreadOnAppServer } from "../app-server/services/threads";
import type { ModelMetadata } from "../domain/catalog/metadata";
import type { ThreadCatalogArchivedReader, ThreadCatalogEventSink } from "../features/threads/catalog/thread-catalog";
import { createKeyedOperationQueue, type KeyedOperationQueue } from "../shared/runtime/keyed-operation-queue";
import { type SettingsDynamicDataAccess, type SettingsHookCatalog, StaleSettingsDynamicDataContextError } from "./dynamic-data";

interface SettingsAppServerQueries {
  contextKey(): string;
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
  const hookMutations = createKeyedOperationQueue<"hooks">();
  const archivedThreadMutations = createKeyedOperationQueue<string>();
  const withSettingsConnection = <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> =>
    options.clientAccess.withClient(operation, {
      serverRequests: { kind: "reject", message: "Codex Panel settings does not handle server requests." },
    });
  const withSettingsMutationConnection = <T>(contextKey: string, operation: (client: AppServerClient) => Promise<T>): Promise<T> =>
    withSettingsConnection((client) => {
      if (options.appServerQueries.contextKey() !== contextKey) throw new StaleSettingsDynamicDataContextError();
      return operation(client);
    });
  const runMutation = <K, T>(queue: KeyedOperationQueue<K>, key: K, contextKey: string, operation: () => Promise<T>): Promise<T> =>
    queue.run(key, () =>
      mapStaleContextError(async () => {
        if (options.appServerQueries.contextKey() !== contextKey) throw new StaleSettingsDynamicDataContextError();
        return operation();
      }),
    );

  return {
    modelsSnapshot: () => options.appServerQueries.modelsSnapshot(),
    observeModelsResult: (listener, observeOptions) => options.appServerQueries.observeModelsResult(listener, observeOptions),
    fetchModels: () => mapStaleContextError(() => options.appServerQueries.fetchModels()),
    refreshModels: () => mapStaleContextError(() => options.appServerQueries.refreshModels()),
    archivedThreadsSnapshot: () => options.threadCatalog.archivedSnapshot(),
    observeArchivedThreadsResult: (listener, observeOptions) => options.threadCatalog.observeArchived(listener, observeOptions),
    refreshArchivedThreads: () => mapStaleContextError(() => options.threadCatalog.refreshArchived()),
    loadHooks: () => withSettingsConnection((client) => loadSettingsHookCatalog(client, options.vaultPath)),
    trustHook: (hook) => {
      const contextKey = options.appServerQueries.contextKey();
      return runMutation(hookMutations, "hooks", contextKey, () =>
        withSettingsMutationConnection(contextKey, (client) => trustHookItem(client, hook)),
      );
    },
    setHookEnabled: (hook, enabled) => {
      const contextKey = options.appServerQueries.contextKey();
      return runMutation(hookMutations, "hooks", contextKey, () =>
        withSettingsMutationConnection(contextKey, (client) => setHookItemEnabled(client, hook, enabled)),
      );
    },
    restoreArchivedThread: (threadId) => {
      const contextKey = options.appServerQueries.contextKey();
      return runMutation(archivedThreadMutations, threadId, contextKey, async () => {
        const thread = await withSettingsMutationConnection(contextKey, (client) => restoreArchivedThreadOnAppServer(client, threadId));
        options.threadCatalog.apply({ type: "thread-restored", thread });
        return thread;
      });
    },
    deleteArchivedThread: (threadId) => {
      const contextKey = options.appServerQueries.contextKey();
      return runMutation(archivedThreadMutations, threadId, contextKey, async () => {
        await withSettingsMutationConnection(contextKey, (client) => deleteThread(client, threadId));
        options.threadCatalog.apply({ type: "thread-deleted", threadId });
      });
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
