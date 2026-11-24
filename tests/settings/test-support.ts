import { expect, vi } from "vitest";
import type { AppServerClient } from "../../src/app-server/connection/client";
import type { CatalogHookMetadata, CatalogModel } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import { AppServerMetadataQueries } from "../../src/app-server/query/metadata-queries";
import { AppServerQueryScope } from "../../src/app-server/query/query-scope";
import type { HookItem, ModelMetadata, ReasoningEffort } from "../../src/domain/runtime/catalog";
import type { Thread } from "../../src/domain/threads/model";
import { createThreadMutationAdapter } from "../../src/features/threads/app-server/workflow-adapters";
import { createThreadMutationCommands } from "../../src/features/threads/workflows/thread-mutation-commands";
import type { SettingsResources } from "../../src/settings/application/resources-controller";
import type { SettingsTabHost } from "../../src/settings/host/contracts";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../src/settings/preferences";
import { panelThreadFixture } from "../support/panel-thread";

type ContextClientOperation = (
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<unknown>,
) => Promise<unknown>;
export const settingsContextClientMock = vi.fn<ContextClientOperation>(() => {
  throw new Error("Unexpected settings client access. Configure useContextClients for this test.");
});

export function panelThread(overrides: Partial<Thread> = {}): Thread {
  return panelThreadFixture({
    id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
    preview: "Preview",
    ...overrides,
  });
}

function appServerThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
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

function settingsRequestClient(
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
  archivedThreads?: Thread[];
  archivedSnapshot?: Thread[] | null;
  refreshArchived?: () => Promise<readonly Thread[]>;
  replacementResources?: SettingsResources;
  settings?: Partial<{
    threadNamingModel: string | null;
    threadNamingEffort: string | null;
    rewriteSelectionModel: string | null;
    rewriteSelectionEffort: string | null;
  }>;
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
  const contextKey = settings.codexPath;
  const clientAccess = {
    withClient: async <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> => {
      return (await settingsContextClientMock(contextKey, "/vault", operation)) as T;
    },
  };
  const scope = new AppServerQueryScope({ codexPath: contextKey, vaultPath: "/vault" }, clientAccess);
  const metadataQueries = new AppServerMetadataQueries(scope);
  function resource<T>(key: string, initial: T | null, load: () => Promise<T>) {
    const options = { queryKey: [key], queryFn: load, staleTime: 0 };
    if (initial !== null) scope.client.setQueryData(options.queryKey, initial);
    return {
      snapshot: () => scope.client.getQueryData<T>(options.queryKey) ?? null,
      watch: (changed: () => void) => scope.watchResult(options, (value) => value, changed),
      fetch: (queryFn = load) => scope.client.fetchQuery({ ...options, queryFn }),
    };
  }
  const models = resource<readonly ModelMetadata[]>(
    "settings-models",
    options.modelsSnapshot ?? null,
    options.fetchModels ?? (async () => options.modelsSnapshot ?? []),
  );
  const archived = resource<readonly Thread[]>(
    "settings-archived",
    options.archivedSnapshot ?? null,
    options.refreshArchived ?? (async () => options.archivedThreads ?? defaultArchivedThreads),
  );
  const threadCatalog = {
    archivedThreadsSnapshot: archived.snapshot,
    refreshArchivedThreads: () => archived.fetch(),
    watchArchivedThreads: archived.watch,
  };
  const queries = {
    fetchModels: () => models.fetch(),
    refreshModels: () => models.fetch(options.refreshModels),
    watchModels: models.watch,
    watchHooks: metadataQueries.watchHooks.bind(metadataQueries),
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
    threadIsBusy: () => false,
  });
  return {
    settings,
    resources: { queries, threadCatalog, threadMutations },
    publishSettings: async (nextSettings) => {
      await (options.saveSettings ?? (async () => undefined))(nextSettings);
      Object.assign(settings, nextSettings);
      return { replacementResources: options.replacementResources ?? null };
    },
  };
}

export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
