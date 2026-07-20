import { expect, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import type { AppServerClientAccessOptions } from "../../src/app-server/connection/client-access";
import type { CatalogHookMetadata, CatalogModel } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import { StaleAppServerResourceContextError } from "../../src/app-server/query/cache";
import type { ModelMetadata, ReasoningEffort } from "../../src/domain/catalog/metadata";
import type { Thread } from "../../src/domain/threads/model";
import type { ThreadCatalogEvent } from "../../src/features/threads/catalog/thread-catalog";
import { createSettingsAppServerDynamicData } from "../../src/settings/app-server-dynamic-data";
import type { SettingsDynamicDataAccess } from "../../src/settings/dynamic-data";
import type { CodexPanelSettingTabHost } from "../../src/settings/host";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../src/settings/model";

type ShortLivedClientOperation = (
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<unknown>,
  options?: AppServerClientAccessOptions,
) => Promise<unknown>;
type ShortLivedClientMock = ReturnType<typeof vi.fn<ShortLivedClientOperation>>;

let shortLivedClientMock: ShortLivedClientMock | null = null;

export function setSettingsShortLivedClientMock(mock: unknown): void {
  shortLivedClientMock = mock as ShortLivedClientMock;
}

function currentShortLivedClientMock(): ShortLivedClientMock {
  if (!shortLivedClientMock) throw new Error("Expected settings short-lived client mock");
  return shortLivedClientMock;
}

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
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: `Display ${modelId}`,
    description: "",
    isDefault,
    hidden,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    supportsPersonality: false,
    serviceTiers: [],
    defaultServiceTier: null,
  } satisfies CatalogModel;
}

export function hook(overrides: Partial<CatalogHookMetadata> = {}): CatalogHookMetadata {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    handlerType: "command",
    matcher: "apply_patch",
    command: "node hook.js",
    timeoutSec: 10n,
    statusMessage: null,
    sourcePath: "/vault/.codex/hooks.json",
    source: "project",
    pluginId: null,
    displayOrder: 0n,
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

export function useShortLivedClients(...clients: SettingsRequestClient[]): void {
  const mock = currentShortLivedClientMock();
  const runWithClient = (client: SettingsRequestClient, operation: (client: AppServerClient) => Promise<unknown>) => operation(client);
  if (clients.length === 1) {
    const [client] = clients;
    if (!client) throw new Error("Expected a short-lived client.");
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
  observeModels?: SettingsDynamicDataAccess["observeModelsResult"];
  refreshChatViews?: () => void;
  refreshThreadsViews?: () => void;
  archivedThreads?: Thread[];
  archivedSnapshot?: Thread[] | null;
  refreshArchived?: () => Promise<readonly Thread[]>;
  observeArchived?: SettingsDynamicDataAccess["observeArchivedThreadsResult"];
  applyThreadCatalogEvent?: (event: ThreadCatalogEvent) => void;
  dynamicData?: SettingsDynamicDataAccess;
  settings?: Partial<{
    threadNamingModel: string | null;
    threadNamingEffort: string | null;
    rewriteSelectionModel: string | null;
    rewriteSelectionEffort: string | null;
  }>;
}

export function settingsTabHost(options: SettingsTabHostOptions = {}): CodexPanelSettingTabHost {
  const defaultArchivedThreads = [panelThread({ id: "thread-archived", preview: "Archived thread", archived: true })];
  const settings = {
    ...DEFAULT_SETTINGS,
    threadNamingModel: options.settings?.threadNamingModel ?? null,
    threadNamingEffort: options.settings?.threadNamingEffort ?? null,
    rewriteSelectionModel: options.settings?.rewriteSelectionModel ?? null,
    rewriteSelectionEffort: options.settings?.rewriteSelectionEffort ?? null,
    sendShortcut: options.sendShortcut ?? "enter",
  };
  const appServerQueries = {
    contextKey: () => settings.codexPath,
    modelsSnapshot: vi.fn(() => options.modelsSnapshot ?? []),
    fetchModels: options.fetchModels ?? vi.fn().mockResolvedValue(options.modelsSnapshot ?? []),
    refreshModels: options.refreshModels ?? vi.fn().mockResolvedValue(options.modelsSnapshot ?? []),
    observeModelsResult: options.observeModels ?? vi.fn(() => () => undefined),
  };
  const threadCatalog = {
    archivedSnapshot: vi.fn(() => options.archivedSnapshot ?? null),
    refreshArchived: options.refreshArchived ?? vi.fn().mockResolvedValue(options.archivedThreads ?? defaultArchivedThreads),
    observeArchived: options.observeArchived ?? vi.fn(() => () => undefined),
    apply: options.applyThreadCatalogEvent ?? vi.fn(),
  };
  const clientAccess = {
    withClient: async <T>(operation: (client: AppServerClient) => Promise<T>, clientOptions?: AppServerClientAccessOptions): Promise<T> => {
      const contextKey = appServerQueries.contextKey();
      const result = (await currentShortLivedClientMock()(
        settings.codexPath,
        "/vault",
        async (client) => {
          if (appServerQueries.contextKey() !== contextKey) throw new StaleAppServerResourceContextError();
          return operation(client);
        },
        clientOptions,
      )) as T;
      if (appServerQueries.contextKey() !== contextKey) throw new StaleAppServerResourceContextError();
      return result;
    },
  };
  const createDynamicData = () =>
    createSettingsAppServerDynamicData({
      vaultPath: "/vault",
      clientAccess,
      appServerQueries,
      threadCatalog,
    });
  let dynamicData = options.dynamicData ?? createDynamicData();
  const host: CodexPanelSettingTabHost = {
    settings,
    dynamicData,
    publishSettings: async (nextSettings) => {
      const previousSettings = { ...settings };
      await (options.saveSettings ?? vi.fn().mockResolvedValue(undefined))(nextSettings);
      const appServerContextReplaced = previousSettings.codexPath !== nextSettings.codexPath;
      Object.assign(settings, nextSettings);
      if (appServerContextReplaced && !options.dynamicData) {
        dynamicData = createDynamicData();
      }
      if (
        previousSettings.showToolbar !== nextSettings.showToolbar ||
        previousSettings.archiveExportEnabled !== nextSettings.archiveExportEnabled
      ) {
        options.refreshChatViews?.();
      }
      if (previousSettings.archiveExportEnabled !== nextSettings.archiveExportEnabled) options.refreshThreadsViews?.();
      return { replacementDynamicData: appServerContextReplaced ? dynamicData : null };
    },
  };
  return host;
}

export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
