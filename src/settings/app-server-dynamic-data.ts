import type { AppServerClient } from "../app-server/connection/client";
import type { AppServerClientAccess } from "../app-server/connection/client-access";
import type { ObservedResultListener } from "../app-server/query/observed-result";
import { isStaleAppServerResourceContextError } from "../app-server/query/resource-store";
import { listHookCatalog, setHookItemEnabled, trustHookItem } from "../app-server/services/catalog";
import { deleteThread, restoreArchivedThread as restoreArchivedThreadOnAppServer } from "../app-server/services/threads";
import type { HookItem, ModelMetadata } from "../domain/catalog/metadata";
import type { ThreadCatalogArchivedReader, ThreadCatalogEventSink } from "../features/threads/catalog/thread-catalog";
import { createKeyedOperationQueue } from "../shared/runtime/keyed-operation-queue";
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
  const archivedThreadMutations = createKeyedOperationQueue<string>();
  const withSettingsConnection = <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> =>
    options.clientAccess.withClient(operation, {
      serverRequests: { kind: "reject", message: "Codex Panel settings does not handle server requests." },
    });
  const runArchivedThreadMutation = <T>(threadId: string, operation: () => Promise<T>): Promise<T> => {
    const contextKey = options.appServerQueries.contextKey();
    return archivedThreadMutations.run(archivedThreadMutationKey(contextKey, threadId), () =>
      mapStaleContextError(async () => {
        if (options.appServerQueries.contextKey() !== contextKey) throw new StaleSettingsDynamicDataContextError();
        return operation();
      }),
    );
  };
  const loadHooks = (client: AppServerClient): Promise<SettingsHookCatalog> => loadSettingsHookCatalog(client, options.vaultPath);
  const mutateHook = (hook: HookItem, mutation: (client: AppServerClient, hook: HookItem) => Promise<void>): Promise<SettingsHookCatalog> =>
    mapStaleContextError(() =>
      withSettingsConnection(async (client) => {
        await mutation(client, hook);
        return loadHooks(client);
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
    refreshHooks: () => mapStaleContextError(() => withSettingsConnection(loadHooks)),
    trustHook: (hook) => mutateHook(hook, trustHookItem),
    setHookEnabled: (hook, enabled) => mutateHook(hook, (client, item) => setHookItemEnabled(client, item, enabled)),
    restoreArchivedThread: (threadId) =>
      runArchivedThreadMutation(threadId, async () => {
        const thread = await withSettingsConnection((client) => restoreArchivedThreadOnAppServer(client, threadId));
        options.threadCatalog.apply({ type: "thread-restored", thread });
        return thread;
      }),
    deleteArchivedThread: (threadId) =>
      runArchivedThreadMutation(threadId, async () => {
        await withSettingsConnection((client) => deleteThread(client, threadId));
        options.threadCatalog.apply({ type: "thread-deleted", threadId });
      }),
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

function archivedThreadMutationKey(contextKey: string, threadId: string): string {
  return `${contextKey}\u0000${threadId}`;
}

async function mapStaleContextError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isStaleAppServerResourceContextError(error)) throw new StaleSettingsDynamicDataContextError();
    throw error;
  }
}
