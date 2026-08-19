import { expect, vi } from "vitest";

import type { AppServerClient } from "../../src/app-server/connection/client";
import type { CatalogHookMetadata, CatalogModel } from "../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../src/app-server/protocol/thread";
import type { HookItem, ModelMetadata, ReasoningEffort } from "../../src/domain/catalog/metadata";
import { diagnosticProbeOk } from "../../src/domain/server/diagnostics";
import type { SharedServerMetadataResourceFor } from "../../src/domain/server/metadata";
import type { Thread } from "../../src/domain/threads/model";
import { createThreadMutationAdapter } from "../../src/features/threads/app-server/workflow-adapters";
import type { ThreadFact } from "../../src/features/threads/workflows/thread-facts";
import { createThreadMutationCommands } from "../../src/features/threads/workflows/thread-mutation-commands";
import { createSettingsResources, type SettingsResources } from "../../src/settings/application/resources";
import type { SettingsTabHost } from "../../src/settings/host/contracts";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../src/settings/preferences";

type ContextClientOperation = (
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<unknown>,
) => Promise<unknown>;
type ContextClientMock = ReturnType<typeof vi.fn<ContextClientOperation>>;

let contextClientMock: ContextClientMock | null = null;

export function setSettingsContextClientMock(mock: unknown): void {
  contextClientMock = mock as ContextClientMock;
}

function currentContextClientMock(): ContextClientMock {
  if (!contextClientMock) throw new Error("Expected settings context client mock");
  return contextClientMock;
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

type SettingsHookFixture = Extract<CatalogHookMetadata, { handlerType: "command" }> & HookItem;

export function hook(overrides: Partial<SettingsHookFixture> = {}): SettingsHookFixture {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    handlerType: "command",
    matcher: "apply_patch",
    command: "node hook.js",
    handlerSummary: "node hook.js",
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

export function useContextClients(...clients: SettingsRequestClient[]): void {
  const mock = currentContextClientMock();
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
  observeModels?: SettingsResources["observeModels"];
  refreshChatViews?: () => void;
  refreshThreadsViews?: () => void;
  archivedThreads?: Thread[];
  archivedSnapshot?: Thread[] | null;
  refreshArchived?: () => Promise<readonly Thread[]>;
  observeArchived?: SettingsResources["observeArchivedThreadsResult"];
  applyThreadFact?: (event: ThreadFact) => void;
  resources?: SettingsResources;
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
  const appServerQueries = {
    metadataSnapshot: () => options.modelsSnapshot ?? [],
    fetchModels: options.fetchModels ?? (async () => options.modelsSnapshot ?? []),
    refreshModels: options.refreshModels ?? (async () => options.modelsSnapshot ?? []),
    observeMetadataResource: (
      _id: "models",
      listener: (resource: SharedServerMetadataResourceFor<"models">) => void,
      observeOptions?: { emitCurrent?: boolean },
    ) =>
      (options.observeModels ?? (() => () => undefined))(
        (models) => listener({ id: "models", value: models, probe: diagnosticProbeOk("models", "models", 0) }),
        observeOptions,
      ),
  };
  const threadCatalog = {
    archivedThreadsSnapshot: () => options.archivedSnapshot ?? null,
    refreshArchivedThreads: options.refreshArchived ?? (async () => options.archivedThreads ?? defaultArchivedThreads),
    observeArchivedThreadsResult: options.observeArchived ?? (() => () => undefined),
  };
  const applyThreadFact = options.applyThreadFact ?? (() => undefined);
  const createResources = () => {
    const contextKey = settings.codexPath;
    const contextIsCurrent = () => settings.codexPath === contextKey;
    const clientAccess = {
      withClient: async <T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> => {
        if (!contextIsCurrent()) throw new Error("Codex execution runtime is no longer active.");
        return (await currentContextClientMock()(contextKey, "/vault", operation)) as T;
      },
    };
    const threadFacts = {
      apply: (fact: ThreadFact) => {
        if (contextIsCurrent()) applyThreadFact(fact);
      },
      applyBatch: (facts: readonly ThreadFact[]) => {
        if (!contextIsCurrent()) return;
        for (const fact of facts) applyThreadFact(fact);
      },
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
      facts: threadFacts,
      referenceThreads: () => threadCatalog.archivedThreadsSnapshot() ?? [],
      threadIsBusy: () => false,
    });
    return createSettingsResources({
      vaultPath: "/vault",
      clientAccess,
      appServerQueries,
      threadCatalog,
      threadMutations,
    });
  };
  let resources = options.resources ?? createResources();
  const host: SettingsTabHost = {
    settings,
    resources,
    publishSettings: async (nextSettings) => {
      const previousSettings = { ...settings };
      await (options.saveSettings ?? (async () => undefined))(nextSettings);
      const codexPathChanged = previousSettings.codexPath !== nextSettings.codexPath;
      Object.assign(settings, nextSettings);
      if (codexPathChanged && !options.resources) {
        resources = createResources();
      }
      if (
        previousSettings.showToolbar !== nextSettings.showToolbar ||
        previousSettings.archiveExportEnabled !== nextSettings.archiveExportEnabled
      ) {
        options.refreshChatViews?.();
      }
      if (previousSettings.archiveExportEnabled !== nextSettings.archiveExportEnabled) options.refreshThreadsViews?.();
      return { replacementResources: codexPathChanged ? resources : null };
    },
  };
  return host;
}

export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
