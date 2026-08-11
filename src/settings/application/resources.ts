import type { AppServerClient } from "../../app-server/connection/client";
import type { AppServerClientAccess } from "../../app-server/connection/client-access";
import { listHookCatalog, setHookItemEnabled, trustHookItem } from "../../app-server/services/catalog";
import type { HookItem, ModelMetadata } from "../../domain/catalog/metadata";
import type { SharedServerMetadataResourceFor } from "../../domain/server/metadata";
import type { Thread } from "../../domain/threads/model";
import type { ThreadCatalogArchivedReader } from "../../features/threads/catalog/thread-catalog";
import type { ThreadMutationCommands } from "../../features/threads/workflows/thread-mutation-commands";
import type { ObservedResultListener } from "../../shared/async/observed-result";

export interface SettingsHookCatalog {
  hooks: readonly HookItem[];
  warnings: readonly string[];
  errors: readonly string[];
  status: string;
}

export interface SettingsResources {
  modelsSnapshot(): readonly ModelMetadata[] | null;
  observeModels(listener: (models: readonly ModelMetadata[]) => void, options?: { emitCurrent?: boolean }): () => void;
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

interface SettingsResourceQueries {
  metadataSnapshot(id: "models"): readonly ModelMetadata[] | null;
  observeMetadataResource(
    id: "models",
    listener: (resource: SharedServerMetadataResourceFor<"models">) => void,
    options?: { emitCurrent?: boolean },
  ): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
}

export interface SettingsResourcesOptions {
  vaultPath: string;
  clientAccess: AppServerClientAccess;
  appServerQueries: SettingsResourceQueries;
  threadCatalog: ThreadCatalogArchivedReader;
  threadMutations: Pick<ThreadMutationCommands, "restoreThread" | "deleteThread">;
}

export function createSettingsResources(options: SettingsResourcesOptions): SettingsResources {
  const withSettingsConnection = <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> =>
    options.clientAccess.withClient(operation);
  const loadHooks = (client: AppServerClient): Promise<SettingsHookCatalog> => loadHookCatalog(client, options.vaultPath);
  const mutateHook = (hook: HookItem, mutation: (client: AppServerClient, hook: HookItem) => Promise<void>): Promise<SettingsHookCatalog> =>
    withSettingsConnection(async (client) => {
      await mutation(client, hook);
      return loadHooks(client);
    });

  return {
    modelsSnapshot: () => options.appServerQueries.metadataSnapshot("models"),
    observeModels: (listener, observeOptions) =>
      options.appServerQueries.observeMetadataResource(
        "models",
        (resource) => {
          if (resource.value !== undefined) listener(resource.value);
        },
        observeOptions,
      ),
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

async function loadHookCatalog(client: AppServerClient, vaultPath: string): Promise<SettingsHookCatalog> {
  const catalog = await listHookCatalog(client, vaultPath);
  const hookCount = catalog.hooks.length;
  return {
    ...catalog,
    status: `Loaded ${String(hookCount)} hook${hookCount === 1 ? "" : "s"}.`,
  };
}
