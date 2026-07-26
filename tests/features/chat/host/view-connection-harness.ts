// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import type { ServerNotification, ServerRequest } from "../../../../src/app-server/connection/rpc-messages";
import { modelMetadataFromCatalogModels } from "../../../../src/app-server/protocol/catalog";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { ModelMetadata } from "../../../../src/domain/catalog/metadata";
import { createServerDiagnostics, diagnosticProbeOk } from "../../../../src/domain/server/diagnostics";
import type {
  SharedServerMetadataResource,
  SharedServerMetadataResourceFor,
  SharedServerMetadataResourceId,
  SharedServerMetadataSnapshotValues,
} from "../../../../src/domain/server/metadata";
import type { Thread } from "../../../../src/domain/threads/model";
import { createThreadGoalCoordinator } from "../../../../src/features/chat/application/threads/thread-goal-coordinator";
import type { ChatRuntimeView, ChatViewRuntimeOwner, CodexChatHost } from "../../../../src/features/chat/host/contracts";
import type { ThreadFact } from "../../../../src/features/threads/workflows/thread-facts";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { createKeyedOperationQueue } from "../../../../src/shared/runtime/keyed-operation-queue";
import type { ObservedPaginatedResult, ObservedResult } from "../../../../src/shared/runtime/observed-result";
import { notices } from "../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../support/dom";
import { runtimeConfigFixture } from "../../../support/runtime-config";
import { chatPanelSettingsAccess } from "../support/settings";

export interface TestCodexChatHost extends CodexChatHost {
  readonly settingsSource: CodexPanelSettings;
  receiveActiveThreads(threads: readonly Thread[]): void;
}
interface SharedServerMetadataFixture {
  runtimeConfig: ReturnType<typeof runtimeConfigFixture> | null;
  availableSkills: NonNullable<SharedServerMetadataSnapshotValues["skills"]>;
  availablePermissionProfiles: NonNullable<SharedServerMetadataSnapshotValues["permissionProfiles"]>;
  rateLimit: SharedServerMetadataSnapshotValues["rateLimits"];
  serverDiagnostics: ReturnType<CodexChatHost["appServerQueries"]["metadataDiagnosticsSnapshot"]>;
}
let CodexChatView: typeof import("../../../../src/features/chat/host/view.obsidian")["CodexChatView"];
interface TrackedView {
  view: { onClose(): Promise<void> | void };
  opened: boolean;
}
let createdViews: TrackedView[] = [];

const connectionMock = vi.hoisted(() => {
  const state = {
    client: null as Record<string, unknown> | null,
    connectCalls: 0,
    connected: false,
    onNotification: null as ((notification: ServerNotification) => void) | null,
    onServerRequest: null as
      | ((request: ServerRequest, responder: { respond(result: unknown): void; reject(code: number, message: string): void }) => void)
      | null,
    onExit: null as (() => void) | null,
  };

  return {
    state,
    reset(): void {
      state.client = null;
      state.connectCalls = 0;
      state.connected = false;
      state.onNotification = null;
      state.onServerRequest = null;
      state.onExit = null;
    },
  };
});

export function connectionMockState(): typeof connectionMock.state {
  return connectionMock.state;
}

vi.mock("../../../../src/app-server/connection/connection-manager", () => {
  class StaleConnectionError extends Error {}

  class ConnectionManager {
    private readonly codexPath: string;
    private readonly cwd: string;
    private handlers: {
      onNotification: (notification: ServerNotification, context: { codexPath: string; cwd: string }) => void;
      onServerRequest: (
        request: unknown,
        responder: { respond(result: unknown): void; reject(code: number, message: string): void },
      ) => void;
      onLog: (message: string) => void;
      onExit: (context: { codexPath: string; cwd: string }) => void;
    } | null;

    constructor(codexPath: string, cwd: string) {
      this.codexPath = codexPath;
      this.cwd = cwd;
      this.handlers = null;
    }

    connect(handlers: {
      onNotification: (notification: ServerNotification, context: { codexPath: string; cwd: string }) => void;
      onServerRequest: (
        request: unknown,
        responder: { respond(result: unknown): void; reject(code: number, message: string): void },
      ) => void;
      onLog: (message: string) => void;
      onExit: (context: { codexPath: string; cwd: string }) => void;
    }): Promise<unknown> {
      this.handlers = handlers;
      this.publishHandlers(handlers);
      connectionMock.state.connectCalls += 1;
      connectionMock.state.connected = true;
      return Promise.resolve({
        userAgent: "codex-test",
        codexHome: "/tmp/codex",
        platformFamily: "unix",
        platformOs: "macos",
      });
    }

    currentClient(): unknown {
      return connectionMock.state.connected ? connectionMock.state.client : null;
    }

    isConnected(): boolean {
      return connectionMock.state.connected;
    }

    resetConnection(): void {
      this.disconnect();
    }

    disconnect(): void {
      connectionMock.state.connected = false;
    }

    exit(): void {
      connectionMock.state.connected = false;
      this.handlers?.onExit({ codexPath: this.codexPath, cwd: this.cwd });
    }

    private publishHandlers(handlers: NonNullable<ConnectionManager["handlers"]>): void {
      const context = { codexPath: this.codexPath, cwd: this.cwd };
      connectionMock.state.onNotification = (notification) => handlers.onNotification(notification, context);
      connectionMock.state.onServerRequest = (request, responder) => handlers.onServerRequest(request, responder);
      connectionMock.state.onExit = () => handlers.onExit(context);
    }
  }

  return { ConnectionManager, StaleConnectionError };
});

installObsidianDomShims();

export function setupViewConnectionHarness(): void {
  let restoreDefaultThreadStreamViewportMetrics: (() => void) | null = null;

  beforeAll(async () => {
    ({ CodexChatView } = await import("../../../../src/features/chat/host/view.obsidian"));
  });

  beforeEach(() => {
    vi.useRealTimers();
    notices.length = 0;
    connectionMock.reset();
    restoreDefaultThreadStreamViewportMetrics = mockThreadStreamViewportOffsetMetrics({ clientHeight: 320, clientWidth: 240 });
  });

  afterEach(async () => {
    for (const entry of createdViews.reverse()) {
      if (entry.opened) await entry.view.onClose();
    }
    createdViews = [];
    vi.useRealTimers();
    restoreDefaultThreadStreamViewportMetrics?.();
    restoreDefaultThreadStreamViewportMetrics = null;
    document.body.replaceChildren();
  });
}

type RequestHandler = ReturnType<typeof vi.fn<(params?: unknown, options?: unknown) => unknown>>;
type RequestSpy = ReturnType<typeof vi.fn<(method: string, params?: unknown, options?: unknown) => unknown>>;
export type RequestHandlers = Record<string, RequestHandler>;
export type TestAppServerClient = {
  requestHandlers: RequestHandlers;
  request: RequestSpy;
};

export function connectedClient(overrides: RequestHandlers = {}): TestAppServerClient {
  return requestClient({ ...baseClientHandlers(), ...overrides });
}

function baseClientHandlers(): RequestHandlers {
  return {
    "config/read": vi.fn().mockResolvedValue({}),
    "model/list": vi.fn().mockResolvedValue({ data: [] }),
    "skills/list": vi.fn().mockResolvedValue({ data: [] }),
    "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: null }),
    "thread/list": vi.fn().mockResolvedValue({ data: [] }),
    "thread/start": vi.fn().mockResolvedValue(startedThread("thread-new")),
    "thread/resume": vi.fn().mockResolvedValue(resumedThread("thread-1")),
    "thread/turns/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    "turn/start": vi.fn().mockResolvedValue({ turn: { id: "turn-1" } }),
    "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("thread-forked") }),
    "thread/name/set": vi.fn().mockResolvedValue({}),
    "thread/goal/get": vi.fn().mockResolvedValue({ goal: null }),
    "thread/goal/set": vi.fn().mockResolvedValue({ goal: goalFixture("thread-1") }),
    "thread/inject_items": vi.fn().mockResolvedValue({}),
    "thread/read": vi.fn().mockResolvedValue({ thread: threadFixture("thread-1") }),
    "thread/archive": vi.fn().mockResolvedValue({}),
  };
}

function requestClient(handlers: RequestHandlers): TestAppServerClient {
  return {
    requestHandlers: handlers,
    request: vi.fn((method: string, params: unknown, options?: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected app-server request: ${method}`);
      return handler(params, options);
    }),
  };
}

export function requestMethods(client: TestAppServerClient): string[] {
  return client.request.mock.calls.map(([method]) => method);
}

export function expectRequestTimes(client: TestAppServerClient, method: string, times: number): void {
  expect(requestMethods(client).filter((calledMethod) => calledMethod === method)).toHaveLength(times);
}

function goalFixture(threadId: string) {
  return {
    threadId,
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function startedThread(threadId: string) {
  return {
    thread: {
      id: threadId,
      name: null,
      preview: "",
      cwd: "/vault",
      cliVersion: "0.0.0",
    },
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  };
}

export function resumedThread(threadId: string, threadOverrides: Record<string, unknown> = {}) {
  return {
    thread: {
      id: threadId,
      name: "Restored thread",
      preview: "Restored thread",
      cwd: "/vault",
      cliVersion: "0.0.0",
      ...threadOverrides,
    },
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  };
}

function threadFromRecord(record: ThreadRecord): Thread {
  return {
    id: record.id,
    preview: record.preview,
    name: record.name,
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function threadFixture(threadId: string): ThreadRecord {
  return {
    id: threadId,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Restored thread",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

export function panelThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

export function turnWithUserMessage(text: string) {
  return {
    id: "turn-1",
    startedAt: 1,
    completedAt: 2,
    items: [{ type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text, text_elements: [] }] }],
  };
}

export function completedTurn(turnId: string) {
  return {
    id: turnId,
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    itemsView: "full",
    items: [
      { type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text: "hello", text_elements: [] }] },
      { type: "agentMessage", id: "agent-1", text: "done", phase: "final_answer", memoryCitation: null },
    ],
  };
}

export function composerElement(view: { containerEl: HTMLElement }): HTMLTextAreaElement {
  const composer = view.containerEl.querySelector<HTMLTextAreaElement>(".codex-panel__composer-input");
  if (!composer) throw new Error("Expected composer input");
  return composer;
}

export function composerPlaceholder(view: { containerEl: HTMLElement }): string | null {
  return composerElement(view).getAttribute("placeholder");
}

function mockThreadStreamViewportOffsetMetrics(metrics: { clientHeight: number; clientWidth: number }): () => void {
  const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__thread-stream") ? metrics.clientHeight : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return this instanceof HTMLElement && this.classList.contains("codex-panel__thread-stream") ? metrics.clientWidth : 0;
    },
  });
  return () => {
    restorePrototypeProperty(HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
    restorePrototypeProperty(HTMLElement.prototype, "offsetWidth", offsetWidthDescriptor);
  };
}

function restorePrototypeProperty<T extends object>(target: T, property: keyof T, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

export function requiredTextArea(parent: ParentNode, selector: string): HTMLTextAreaElement {
  const element = parent.querySelector<HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

export function requiredButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const element = parent.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

export async function submitComposerByEnter(view: { containerEl: HTMLElement }): Promise<void> {
  await flushAsyncTicks();
  const composer = requiredTextArea(view.containerEl, ".codex-panel__composer-input");
  composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await flushAsyncTicks();
}

async function flushAsyncTicks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

export interface ChatHostFixtureOverrides {
  settings?: Partial<CodexPanelSettings>;
  vaultPath?: string;
  openThreadInNewView?: CodexChatHost["workspace"]["openThreadInNewView"];
  openThreadInAvailableView?: CodexChatHost["workspace"]["openThreadInAvailableView"];
  openThreadFromPanel?: CodexChatHost["workspace"]["openThreadFromPanel"];
  focusThreadInOpenView?: CodexChatHost["workspace"]["focusThreadInOpenView"];
  openTurnDiff?: CodexChatHost["workspace"]["openTurnDiff"];
  notifyPanelActivityChanged?: CodexChatHost["workspace"]["notifyPanelActivityChanged"];
  openSideChat?: CodexChatHost["workspace"]["openSideChat"];
  applyThreadFact?: CodexChatHost["threadFacts"]["apply"];
  refreshActiveThreads?: CodexChatHost["threadCatalog"]["refreshActiveThreads"];
  activeThreadsSnapshot?: CodexChatHost["threadCatalog"]["activeThreadsSnapshot"];
  sharedMetadataSnapshot?: () => SharedServerMetadataFixture | null;
  modelsSnapshot?: () => SharedServerMetadataSnapshotValues["models"];
  fetchModels?: CodexChatHost["appServerQueries"]["fetchModels"];
  refreshModels?: CodexChatHost["appServerQueries"]["refreshModels"];
  refreshAppServerMetadata?: CodexChatHost["appServerQueries"]["refreshAppServerMetadata"];
  refreshSkills?: CodexChatHost["appServerQueries"]["refreshSkills"];
  refreshRateLimits?: CodexChatHost["appServerQueries"]["refreshRateLimits"];
  threadNameMutations?: CodexChatHost["threadNameMutations"];
}

export function chatHost(overrides: ChatHostFixtureOverrides = {}): TestCodexChatHost {
  let activeThreads = overrides.activeThreadsSnapshot?.() ?? null;
  let metadata = overrides.sharedMetadataSnapshot?.() ?? null;
  let models = overrides.modelsSnapshot?.() ?? null;
  const activeThreadResultListeners = new Set<(result: ObservedPaginatedResult<readonly Thread[]>) => void>();
  const metadataResourceListeners = new Set<(resource: SharedServerMetadataResource) => void>();
  const modelResultListeners = new Set<(result: ObservedResult<readonly ModelMetadata[]>) => void>();
  const settings = {
    ...DEFAULT_SETTINGS,
    codexPath: "codex",
    sendShortcut: "enter" as const,
    ...overrides.settings,
  };
  const vaultPath = overrides.vaultPath ?? "/vault";
  const applyMetadataToCache = (nextMetadata: SharedServerMetadataFixture): SharedServerMetadataFixture => {
    metadata = nextMetadata;
    const resources: SharedServerMetadataResource[] = [
      { id: "runtimeConfig", value: nextMetadata.runtimeConfig ?? undefined },
      {
        id: "skills",
        value: nextMetadata.availableSkills,
        probe: nextMetadata.serverDiagnostics.probes.skills,
      },
      {
        id: "permissionProfiles",
        value: nextMetadata.availablePermissionProfiles,
        probe: nextMetadata.serverDiagnostics.probes.permissionProfiles,
      },
      {
        id: "rateLimits",
        value: nextMetadata.rateLimit,
        probe: nextMetadata.serverDiagnostics.probes.rateLimits,
      },
    ];
    for (const listener of metadataResourceListeners) {
      for (const resource of resources) listener(resource);
    }
    return nextMetadata;
  };
  const currentMetadataResource = (id: SharedServerMetadataResourceId): SharedServerMetadataResource | undefined => {
    if (id === "runtimeConfig") return metadata ? { id, value: metadata.runtimeConfig ?? undefined } : undefined;
    if (id === "models") {
      return models ? { id, value: models, probe: diagnosticProbeOk("models", `${String(models.length)} models`, Date.now()) } : undefined;
    }
    if (!metadata) return undefined;
    if (id === "skills") return { id, value: metadata.availableSkills, probe: metadata.serverDiagnostics.probes.skills };
    if (id === "permissionProfiles") {
      return { id, value: metadata.availablePermissionProfiles, probe: metadata.serverDiagnostics.probes.permissionProfiles };
    }
    return { id, value: metadata.rateLimit, probe: metadata.serverDiagnostics.probes.rateLimits };
  };
  const observeMetadataResource = <Id extends SharedServerMetadataResourceId>(
    id: Id,
    listener: (resource: SharedServerMetadataResourceFor<Id>) => void,
    options: { emitCurrent?: boolean } = {},
  ): (() => void) => {
    const aggregateListener = (resource: SharedServerMetadataResource): void => {
      if (resource.id === id) listener(resource as SharedServerMetadataResourceFor<Id>);
    };
    metadataResourceListeners.add(aggregateListener);
    if (options.emitCurrent ?? true) {
      const resource = currentMetadataResource(id);
      if (resource) listener(resource as SharedServerMetadataResourceFor<Id>);
    }
    return () => {
      metadataResourceListeners.delete(aggregateListener);
    };
  };
  const metadataSnapshot = <Id extends SharedServerMetadataResourceId>(id: Id): SharedServerMetadataSnapshotValues[Id] => {
    const value =
      id === "runtimeConfig"
        ? (metadata?.runtimeConfig ?? null)
        : id === "models"
          ? models
          : id === "skills"
            ? (metadata?.availableSkills ?? null)
            : id === "permissionProfiles"
              ? (metadata?.availablePermissionProfiles ?? null)
              : metadata?.rateLimit;
    return value as SharedServerMetadataSnapshotValues[Id];
  };
  const loadAppServerMetadata = async (reloadSkills = false): Promise<SharedServerMetadataFixture | null> => {
    const client = connectionMock.state.client as TestAppServerClient | null;
    if (!client || !connectionMock.state.connected) return null;
    const connectionStillCurrent = () => connectionMock.state.client === client && connectionMock.state.connected;
    await client.request("config/read", { cwd: vaultPath, includeLayers: true });
    if (!connectionStillCurrent()) return null;
    let fetchedModels: readonly ModelMetadata[];
    if (overrides.fetchModels) {
      fetchedModels = await overrides.fetchModels();
    } else {
      const modelsResponse = (await client.request("model/list", { includeHidden: false, limit: 100 })) as {
        data: Parameters<typeof modelMetadataFromCatalogModels>[0];
      };
      fetchedModels = modelMetadataFromCatalogModels(modelsResponse.data);
    }
    if (!connectionStillCurrent()) return null;
    models = fetchedModels;
    const modelsResource: SharedServerMetadataResource = {
      id: "models",
      value: fetchedModels,
      probe: diagnosticProbeOk("models", `${String(fetchedModels.length)} models`, Date.now()),
    };
    for (const listener of metadataResourceListeners) listener(modelsResource);
    for (const listener of modelResultListeners) listener(queryResult(fetchedModels));
    const skillsResponse = (await client.request("skills/list", { cwds: [vaultPath], forceReload: reloadSkills })) as {
      data: { skills: { name: string; description?: string; path?: string; enabled?: boolean }[] }[];
    };
    if (!connectionStillCurrent()) return null;
    const permissionProfilesResponse = (await client.request("permissionProfile/list", { cwd: vaultPath, cursor: null, limit: 100 })) as {
      data: { id: string; description: string | null; allowed: boolean }[];
      nextCursor: string | null;
    };
    if (!connectionStillCurrent()) return null;
    await client.request("account/rateLimits/read", undefined);
    if (!connectionStillCurrent()) return null;
    return {
      runtimeConfig: runtimeConfigFixture(),
      availableSkills: skillsResponse.data.flatMap(
        (entry: { skills: { name: string; description?: string; path?: string; enabled?: boolean }[] }) =>
          entry.skills.map((skill) => ({
            name: skill.name,
            description: skill.description ?? "",
            path: skill.path ?? "",
            enabled: skill.enabled ?? true,
          })),
      ),
      availablePermissionProfiles: permissionProfilesResponse.data.map((profile) => ({ ...profile })),
      rateLimit: null,
      serverDiagnostics: createServerDiagnostics(),
    };
  };
  const emitActiveThreads = (): void => {
    if (!activeThreads) return;
    for (const listener of activeThreadResultListeners) listener(paginatedQueryResult(activeThreads));
  };
  const upsertActiveThread = (thread: Thread): void => {
    activeThreads = [thread, ...(activeThreads?.filter((item) => item.id !== thread.id) ?? [])];
    emitActiveThreads();
  };
  const applyThreadFact = (event: ThreadFact): void => {
    switch (event.type) {
      case "thread-archived":
      case "thread-deleted":
        activeThreads = activeThreads?.filter((thread) => thread.id !== event.threadId) ?? null;
        emitActiveThreads();
        return;
      case "thread-renamed":
        activeThreads = activeThreads?.map((thread) => (thread.id === event.threadId ? { ...thread, name: event.name } : thread)) ?? null;
        emitActiveThreads();
        return;
      case "thread-upserted":
      case "thread-restored":
        upsertActiveThread(event.thread);
        return;
      case "thread-unarchived":
        return;
    }
  };
  return {
    appServerClientAccess: {
      withClient: async (operation) => {
        const client = connectionMock.state.client as TestAppServerClient | null;
        if (!client) throw new Error("Codex app-server is not connected.");
        return operation(client as never);
      },
    },
    appServerContext: { codexPath: settings.codexPath, vaultPath },
    settingsSource: settings,
    receiveActiveThreads: (threads) => {
      activeThreads = threads;
      emitActiveThreads();
    },
    threadNameMutations: overrides.threadNameMutations ?? createKeyedOperationQueue(),
    threadTitlePort: {
      persistedContext: vi.fn().mockResolvedValue(null),
      generateTitle: vi.fn().mockResolvedValue(null),
    },
    threadAutoTitleWork: { submit: vi.fn() },
    threadGoalCoordinator: createThreadGoalCoordinator(),
    runtimeSettingsCommitQueue: createKeyedOperationQueue(),
    settings: chatPanelSettingsAccess(settings),
    workspace: {
      openThreadInNewView: overrides.openThreadInNewView ?? vi.fn(),
      openThreadInAvailableView: overrides.openThreadInAvailableView ?? vi.fn(),
      openThreadFromPanel: overrides.openThreadFromPanel ?? vi.fn(),
      focusThreadInOpenView: overrides.focusThreadInOpenView ?? vi.fn().mockResolvedValue(false),
      threadHasPendingOrRunningPanel: vi.fn(() => false),
      openTurnDiff: overrides.openTurnDiff ?? vi.fn(),
      notifyPanelActivityChanged: overrides.notifyPanelActivityChanged ?? vi.fn(),
      openSideChat: overrides.openSideChat ?? vi.fn().mockResolvedValue(undefined),
    },
    appServerQueries: {
      metadataSnapshot,
      metadataDiagnosticsSnapshot: vi.fn(() => metadata?.serverDiagnostics ?? createServerDiagnostics()),
      refreshAppServerMetadata:
        overrides.refreshAppServerMetadata ??
        vi.fn(async () => {
          const nextMetadata = await loadAppServerMetadata();
          if (nextMetadata) applyMetadataToCache(nextMetadata);
        }),
      refreshSkills:
        overrides.refreshSkills ??
        vi.fn(async () => {
          const nextMetadata = await loadAppServerMetadata(true);
          if (nextMetadata) applyMetadataToCache(nextMetadata);
        }),
      refreshRateLimits:
        overrides.refreshRateLimits ??
        vi.fn(async () => {
          const nextMetadata = await loadAppServerMetadata();
          if (nextMetadata) applyMetadataToCache(nextMetadata);
        }),
      fetchModels: overrides.fetchModels ?? vi.fn(async () => models ?? []),
      refreshModels: overrides.refreshModels ?? vi.fn(async () => models ?? []),
      observeMetadataResource,
      observeModelsResult: (listener, options = {}) => {
        modelResultListeners.add(listener);
        if ((options.emitCurrent ?? true) && models) listener(queryResult(models));
        return () => {
          modelResultListeners.delete(listener);
        };
      },
    },
    threadCatalog: {
      hasMoreActiveThreads: vi.fn(() => false),
      loadMoreActiveThreads: vi.fn(async () => activeThreads ?? []),
      refreshActiveThreads:
        overrides.refreshActiveThreads ??
        (vi.fn(async () => {
          const client = connectionMock.state.client;
          if (!client) return activeThreads ?? [];
          const request = client["request"] as (method: string, params: Record<string, unknown>) => Promise<{ data: ThreadRecord[] }>;
          const response = await request("thread/list", {
            cwd: "/vault",
            archived: false,
            sortKey: "recency_at",
            sortDirection: "desc",
          });
          activeThreads = response.data.map(threadFromRecord);
          for (const listener of activeThreadResultListeners) listener(paginatedQueryResult(activeThreads));
          return activeThreads;
        }) as CodexChatHost["threadCatalog"]["refreshActiveThreads"]),
      fetchActiveThreads: vi.fn(async () => {
        const client = connectionMock.state.client;
        if (!client) return activeThreads ?? [];
        const request = client["request"] as (method: string, params: Record<string, unknown>) => Promise<{ data: ThreadRecord[] }>;
        const response = await request("thread/list", {
          cwd: "/vault",
          archived: false,
          sortKey: "recency_at",
          sortDirection: "desc",
        });
        activeThreads = response.data.map(threadFromRecord);
        for (const listener of activeThreadResultListeners) listener(paginatedQueryResult(activeThreads));
        return activeThreads;
      }),
      activeThreadsSnapshot: overrides.activeThreadsSnapshot ?? vi.fn(() => activeThreads),
      recentActiveThreadsSnapshot: vi.fn(() => activeThreads),
      observeActiveThreadsResult: (listener, options = {}) => {
        activeThreadResultListeners.add(listener);
        if ((options.emitCurrent ?? true) && activeThreads) listener(paginatedQueryResult(activeThreads));
        return () => activeThreadResultListeners.delete(listener);
      },
    },
    threadFacts: {
      apply: overrides.applyThreadFact ?? applyThreadFact,
      applyBatch: (facts) => {
        for (const fact of facts) (overrides.applyThreadFact ?? applyThreadFact)(fact);
      },
    },
  };
}

function paginatedQueryResult<T>(value: T | null): ObservedPaginatedResult<T> {
  return {
    ...queryResult(value),
    hasMore: false,
    isFetchingNextPage: false,
  };
}

function queryResult<T>(value: T | null): ObservedResult<T> {
  return {
    value,
    error: null,
    isFetching: false,
  };
}

export interface TestChatViewRuntimeOwner extends ChatViewRuntimeOwner {
  replace(host: CodexChatHost): void;
}

export function chatViewRuntimeOwner(initialHost: CodexChatHost): TestChatViewRuntimeOwner {
  let host = initialHost;
  let view: ChatRuntimeView | null = null;
  return {
    attachChatView: (nextView) => {
      view = nextView;
      nextView.attachRuntime(host);
    },
    replace: (nextHost) => {
      host = nextHost;
      view?.detachRuntime();
      view?.attachRuntime(host);
    },
  };
}

export async function chatView(
  options: { host?: CodexChatHost; runtimeOwner?: ChatViewRuntimeOwner; requestSaveLayout?: () => void } = {},
) {
  const host = options.host ?? chatHost();
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);
  containerEl.createDiv();
  containerEl.createDiv();
  const view = new CodexChatView(
    {
      app: {
        workspace: {
          getActiveFile: vi.fn(() => null),
          getActiveViewOfType: vi.fn(() => null),
          getLastOpenFiles: vi.fn(() => []),
          on: vi.fn(() => ({})),
          openLinkText: vi.fn(),
          requestSaveLayout: options.requestSaveLayout ?? vi.fn(),
        },
        vault: {
          on: vi.fn(() => ({})),
          offref: vi.fn(),
          getFiles: vi.fn(() => []),
          getMarkdownFiles: vi.fn(() => []),
          getAbstractFileByPath: vi.fn(() => null),
        },
        metadataCache: {
          on: vi.fn(() => ({})),
          offref: vi.fn(),
          getFirstLinkpathDest: vi.fn(() => null),
          fileToLinktext: vi.fn(() => ""),
          getFileCache: vi.fn(() => null),
        },
      },
      containerEl,
    } as never,
    options.runtimeOwner ?? chatViewRuntimeOwner(host),
  );
  (view.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(view);
  const tracked: TrackedView = { view, opened: false };
  const onOpen = view.onOpen.bind(view);
  const onClose = view.onClose.bind(view);
  view.onOpen = async () => {
    tracked.opened = true;
    await onOpen();
  };
  view.onClose = async () => {
    tracked.opened = false;
    await onClose();
  };
  createdViews.push(tracked);
  return view;
}
