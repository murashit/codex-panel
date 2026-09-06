import { expect, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import type { CatalogHookMetadata, CatalogModel } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import { AppServerMetadataQueries } from "../../src/app-server/query/metadata-queries";
import { AppServerQueryScope } from "../../src/app-server/query/query-scope";
import type { HookItem, ModelMetadata, ReasoningEffort } from "../../src/domain/catalog/metadata";
import type { Thread } from "../../src/domain/threads/model";
import { createThreadMutationAdapter } from "../../src/features/threads/app-server/workflow-adapters";
import { createThreadMutationCommands } from "../../src/features/threads/workflows/thread-mutation-commands";
import type { SettingsResources } from "../../src/settings/application/resources";
import type { SettingsTabHost } from "../../src/settings/host/contracts";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../src/settings/preferences";
import type { ObservedResult } from "../../src/shared/async/observed-result";

type ContextClientOperation = (
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<unknown>,
) => Promise<unknown>;
export const settingsContextClientMock = vi.fn<ContextClientOperation>(() => {
  throw new Error("Unexpected settings client access. Configure useContextClients for this test.");
});

export function panelThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

export function appServerThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    sessionId: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/tmp",
    cliVersion: "codex-cli 0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

export function model(modelId: string, isDefault = false, hidden = false, efforts: ReasoningEffort[] = ["medium"]): CatalogModel {
  return {
    id: `${modelId}-id`,
    model: modelId,
    displayName: `Display ${modelId}`,
    description: "",
    isDefault,
    hidden,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    serviceTiers: [],
    defaultServiceTier: null,
  } satisfies CatalogModel;
}

type SettingsHookFixture = Extract<CatalogHookMetadata, { handlerType: "command" }> & HookItem;

export function hook(overrides: Partial<SettingsHookFixture> = {}): SettingsHookFixture {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    handlerType: "command",
    matcher: "apply_patch",
    command: "node hook.js",
    handlerSummary: "node hook.js",
    statusMessage: null,
    sourcePath: "/vault/.codex/hooks.json",
    enabled: true,
    isManaged: false,
    currentHash: "hash",
    trustStatus: "trusted",
    ...overrides,
  };
}

export function settingsClient(
  options: { models?: CatalogModel[]; hooks?: CatalogHookMetadata[]; hooksError?: Error; threads?: ThreadRecord[] } = {},
): SettingsRequestClient {
  return settingsRequestClient({
    "model/list": vi.fn().mockResolvedValue({ data: options.models ?? [model("gpt-5.4")] }),
    "hooks/list": vi.fn().mockImplementation(() => {
      if (options.hooksError) return Promise.reject(options.hooksError);
      return Promise.resolve({
        data: [
          {
            cwd: "/vault",
            hooks: options.hooks ?? [],
            warnings: [],
            errors: [],
          },
        ],
      });
    }),
    "thread/list": vi.fn().mockResolvedValue({ data: options.threads ?? [appServerThread({ preview: "Archived" })] }),
    "config/batchWrite": vi.fn().mockResolvedValue({}),
    "thread/unarchive": vi.fn().mockResolvedValue({ thread: appServerThread({ preview: "Restored" }) }),
    "thread/delete": vi.fn().mockResolvedValue({}),
  });
}

export type SettingsRequestClient = AppServerClient & {
  request: ReturnType<typeof vi.fn<(method: string, params?: unknown, options?: unknown) => unknown>>;
  requestHandlers: Record<string, ReturnType<typeof vi.fn<(params?: unknown, options?: unknown) => unknown>>>;
};

export function useContextClients(...clients: SettingsRequestClient[]): void {
  const mock = settingsContextClientMock;
  const runWithClient = (client: SettingsRequestClient, operation: (client: AppServerClient) => Promise<unknown>) => operation(client);
  if (clients.length === 1) {
    const [client] = clients;
    if (!client) throw new Error("Expected a context client.");
    mock.mockImplementation((_codexPath: string, _cwd: string, operation: (client: AppServerClient) => Promise<unknown>) =>
      runWithClient(client, operation),
    );
    return;
  }
  for (const client of clients) {
    mock.mockImplementationOnce((_codexPath: string, _cwd: string, operation: (client: AppServerClient) => Promise<unknown>) =>
      runWithClient(client, operation),
    );
  }
}

export function settingsRequestClient(
  handlers: Record<string, ReturnType<typeof vi.fn<(params?: unknown, options?: unknown) => unknown>>>,
): SettingsRequestClient {
  return {
    requestHandlers: handlers,
    request: vi.fn((method: string, params: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      return handler(params);
    }),
  } as unknown as SettingsRequestClient;
}

export function requestMethods(client: SettingsRequestClient): string[] {
  return client.request.mock.calls.map(([method]) => method);
}

export function expectRequestTimes(client: SettingsRequestClient, method: string, times: number): void {
  expect(requestMethods(client).filter((calledMethod) => calledMethod === method)).toHaveLength(times);
}

export interface SettingsTabHostOptions {
  saveSettings?: (settings: CodexPanelSettings) => Promise<void>;
  sendShortcut?: "enter" | "mod-enter";
  modelsSnapshot?: ModelMetadata[];
  fetchModels?: () => Promise<readonly ModelMetadata[]>;
  refreshModels?: () => Promise<readonly ModelMetadata[]>;
  observeModels?: SettingsResources["queries"]["observeModelsResult"];
  archivedThreads?: Thread[];
  archivedSnapshot?: Thread[] | null;
  refreshArchived?: () => Promise<readonly Thread[]>;
  observeArchived?: SettingsResources["threadCatalog"]["observeArchivedThreadsResult"];
  resources?: SettingsResources;
  replacementResources?: SettingsResources;
  settings?: Partial<{
    threadNamingModel: string | null;
    threadNamingEffort: string | null;
    rewriteSelectionModel: string | null;
    rewriteSelectionEffort: string | null;
  }>;
}

function observedResource<T>(initial: T | null) {
  let result: ObservedResult<T> = { value: initial, error: null, isFetching: false };
  const listeners = new Set<(result: ObservedResult<T>) => void>();
  const emit = (): void => {
    for (const listener of listeners) listener(result);
  };
  return {
    observe(
      listener: (result: ObservedResult<T>) => void,
      options?: { emitCurrent?: boolean },
      observeExternal?: (listener: (result: ObservedResult<T>) => void, options?: { emitCurrent?: boolean }) => () => void,
    ) {
      listeners.add(listener);
      if (options?.emitCurrent ?? true) listener(result);
      const unsubscribeExternal = observeExternal?.(listener, options);
      return () => {
        listeners.delete(listener);
        unsubscribeExternal?.();
      };
    },
    async load(load: () => Promise<T>): Promise<T> {
      result = { ...result, isFetching: true };
      emit();
      try {
        const value = await load();
        result = { value, error: null, isFetching: false };
        emit();
        return value;
      } catch (error) {
        result = { ...result, error: error instanceof Error ? error : new Error(String(error)), isFetching: false };
        emit();
        throw error;
      }
    },
  };
}

export function settingsTabHost(options: SettingsTabHostOptions = {}): SettingsTabHost {
  const defaultArchivedThreads = [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })];
  const settings = {
    ...DEFAULT_SETTINGS,
    threadNamingModel: options.settings?.threadNamingModel ?? null,
    threadNamingEffort: options.settings?.threadNamingEffort ?? null,
    rewriteSelectionModel: options.settings?.rewriteSelectionModel ?? null,
    rewriteSelectionEffort: options.settings?.rewriteSelectionEffort ?? null,
    sendShortcut: options.sendShortcut ?? "enter",
  };
  const models = observedResource<readonly ModelMetadata[]>(options.modelsSnapshot ?? null);
  const archived = observedResource<readonly Thread[]>(options.archivedSnapshot ?? null);
  const threadCatalog = {
    archivedThreadsSnapshot: () => options.archivedSnapshot ?? null,
    refreshArchivedThreads: () => archived.load(options.refreshArchived ?? (async () => options.archivedThreads ?? defaultArchivedThreads)),
    observeArchivedThreadsResult: (
      listener: (result: ObservedResult<readonly Thread[]>) => void,
      observeOptions?: { emitCurrent?: boolean },
    ) => archived.observe(listener, observeOptions, options.observeArchived),
  };
  const createResources = () => {
    const contextKey = settings.codexPath;
    const clientAccess = {
      withClient: async <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> => {
        return (await settingsContextClientMock(contextKey, "/vault", operation)) as T;
      },
    };
    const metadataQueries = new AppServerMetadataQueries(
      new AppServerQueryScope({ codexPath: contextKey, vaultPath: "/vault" }, clientAccess),
    );
    const queries = {
      fetchModels: () => models.load(options.fetchModels ?? (async () => options.modelsSnapshot ?? [])),
      refreshModels: () => models.load(options.refreshModels ?? (async () => options.modelsSnapshot ?? [])),
      observeModelsResult: (
        listener: (result: ObservedResult<readonly ModelMetadata[]>) => void,
        observeOptions?: { emitCurrent?: boolean },
      ) => models.observe(listener, observeOptions, options.observeModels),
      observeHooksResult: metadataQueries.observeHooksResult.bind(metadataQueries),
      refreshHooks: metadataQueries.refreshHooks.bind(metadataQueries),
      trustHook: metadataQueries.trustHook.bind(metadataQueries),
      setHookEnabled: metadataQueries.setHookEnabled.bind(metadataQueries),
    };
    const threadMutations = createThreadMutationCommands({
      port: createThreadMutationAdapter(clientAccess),
      archiveExport: {
        settings: () => ({
          archiveExportFolderTemplate: settings.archiveExportFolderTemplate,
          archiveExportFilenameTemplate: settings.archiveExportFilenameTemplate,
          archiveExportTags: settings.archiveExportTags,
        }),
        enabled: () => settings.archiveExportEnabled,
        vaultPath: "/vault",
        vaultConfigDir: ".obsidian",
      },
      archiveDestination: () => ({
        normalizePath: (path) => path,
        exists: vi.fn().mockResolvedValue(false),
        createFolder: vi.fn().mockResolvedValue(undefined),
        createMarkdownFile: vi.fn().mockResolvedValue(undefined),
      }),
      facts: { apply: () => undefined, applyBatch: () => undefined },
      referenceThreads: () => threadCatalog.archivedThreadsSnapshot() ?? [],
      threadIsBusy: () => false,
    });
    return {
      queries,
      threadCatalog,
      threadMutations,
    };
  };
  const resources = options.resources ?? createResources();
  const host: SettingsTabHost = {
    settings,
    resources,
    publishSettings: async (nextSettings) => {
      await (options.saveSettings ?? (async () => undefined))(nextSettings);
      Object.assign(settings, nextSettings);
      return { replacementResources: options.replacementResources ?? null };
    },
  };
  return host;
}

export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
