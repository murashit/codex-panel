// @vitest-environment jsdom

import { afterEach, beforeEach, expect, vi } from "vitest";
import type { ServerNotification, ServerRequest } from "../../../../src/app-server/connection/rpc-messages";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { ActiveThreadData } from "../../../../src/app-server/query/active-thread-inventory";
import { AppServerMetadataQueries } from "../../../../src/app-server/query/metadata-queries";
import { AppServerQueryScope } from "../../../../src/app-server/query/query-scope";
import { AppServerThreadCatalog } from "../../../../src/app-server/query/thread-catalog-queries";
import { AppServerThreadGoalQueries } from "../../../../src/app-server/query/thread-goal-queries";
import type { Thread } from "../../../../src/domain/threads/model";
import type { ChatRuntimeView, ChatViewRuntimeOwner, CodexChatHost } from "../../../../src/features/chat/host/contracts";
import { projectThreadFacts } from "../../../../src/features/threads/workflows/thread-projection";
import { createThreadReplacementPublication } from "../../../../src/features/threads/workflows/thread-replacement-publication";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../../../src/settings/preferences";
import { createKeyedOperationCoordinator } from "../../../../src/shared/async/keyed-operation-coordinator";
import { notices } from "../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../support/dom";
import { threadMutationCommandsMock } from "../../../support/thread-mutations";
import { chatPanelSettingsAccess } from "../support/settings";

export interface TestCodexChatHost extends CodexChatHost {
  readonly settingsSource: CodexPanelSettings;
  receiveActiveThreads(threads: readonly Thread[]): void;
}
interface TrackedView {
  view: { onClose(): Promise<void> | void };
  opened: boolean;
}
let createdViews: TrackedView[] = [];
let createdQueryScopes: AppServerQueryScope[] = [];

const connectionState = {
  client: null as Record<string, unknown> | null,
  connectCalls: 0,
  connected: false,
  onNotification: null as ((notification: ServerNotification) => void) | null,
  onServerRequest: null as
    | ((request: ServerRequest, responder: { respond(result: unknown): void; reject(code: number, message: string): void }) => void)
    | null,
  onExit: null as (() => void) | null,
};

const connectionMock = {
  state: connectionState,
  reset(): void {
    connectionState.client = null;
    connectionState.connectCalls = 0;
    connectionState.connected = false;
    connectionState.onNotification = null;
    connectionState.onServerRequest = null;
    connectionState.onExit = null;
  },
};

export function connectionMockState(): typeof connectionMock.state {
  return connectionMock.state;
}

function contextConnectionMock(
  handleContextNotification?: (notification: ServerNotification) => boolean,
  onContextExit?: () => void,
): CodexChatHost["appServerConnection"] {
  return {
    createLease: () => {
      let connected = false;
      let client: Record<string, unknown> | null = null;
      return {
        connect: async (handlers) => {
          connectionMock.state.connectCalls += 1;
          connectionMock.state.connected = true;
          connected = true;
          client = connectionMock.state.client;
          connectionMock.state.onNotification = (notification) => {
            if (!handleContextNotification?.(notification)) handlers.onNotification(notification);
          };
          connectionMock.state.onServerRequest = (request, responder) => {
            handlers.onServerRequest(request, responder);
          };
          connectionMock.state.onExit = () => {
            connected = false;
            onContextExit?.();
            handlers.onExit();
          };
          return {
            userAgent: "codex-test",
            codexHome: "/tmp/codex",
            platformFamily: "unix",
            platformOs: "macos",
          };
        },
        currentClient: () => (connected ? (client as never) : null),
        isConnected: () => connected && connectionMock.state.connected,
        disconnect: () => {
          connected = false;
        },
      };
    },
  };
}

const { CodexChatView } = await import("../../../../src/features/chat/host/view.obsidian");

export function setupViewConnectionHarness(): void {
  installObsidianDomShims();
  let restoreDefaultThreadStreamViewportMetrics: (() => void) | null = null;

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
    for (const scope of createdQueryScopes) scope.dispose();
    createdQueryScopes = [];
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
    "config/read": vi.fn().mockResolvedValue({ config: {}, layers: null }),
    "model/list": vi.fn().mockResolvedValue({ data: [] }),
    "skills/list": vi.fn().mockResolvedValue({ data: [] }),
    "permissionProfile/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    "account/rateLimits/read": vi.fn().mockResolvedValue({ rateLimits: null }),
    "thread/list": vi.fn().mockResolvedValue({ data: [] }),
    "threadSection/list": vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
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
  openTurnDiff?: CodexChatHost["workspace"]["openTurnDiff"];
  notifyPanelActivityChanged?: CodexChatHost["workspace"]["notifyPanelActivityChanged"];
  toolInventoryQueries?: CodexChatHost["toolInventoryQueries"];
  threadMutations?: Partial<CodexChatHost["threadMutations"]>;
}

export function chatHost(overrides: ChatHostFixtureOverrides = {}): TestCodexChatHost {
  const settings = {
    ...DEFAULT_SETTINGS,
    codexPath: "codex",
    sendShortcut: "enter" as const,
    ...overrides.settings,
  };
  const vaultPath = overrides.vaultPath ?? "/vault";
  const queryScope = new AppServerQueryScope(
    { codexPath: settings.codexPath, vaultPath },
    {
      withClient: async (operation) => {
        const client = connectionMock.state.client;
        if (!client) throw new Error("App-server client is unavailable.");
        return operation(client as never);
      },
    },
  );
  createdQueryScopes.push(queryScope);
  const appServerQueries = new AppServerMetadataQueries(queryScope);
  const threadCatalog = new AppServerThreadCatalog(queryScope);
  const threadGoalQueries = new AppServerThreadGoalQueries(queryScope);
  const replacementPublication = createThreadReplacementPublication(
    (facts) => threadCatalog.applyThreadCatalogChanges(projectThreadFacts(threadCatalog, facts)),
    () => threadCatalog.freezeActiveThreads(),
  );
  const appServerConnection = contextConnectionMock(
    (notification) => {
      if (notification.method === "thread/goal/updated" || notification.method === "thread/goal/cleared") {
        threadGoalQueries.applyNotification(notification);
        return true;
      }
      return false;
    },
    () => queryScope.invalidate(),
  );

  return {
    appServerConnection,
    threadGoalQueries,
    appServerContext: { codexPath: settings.codexPath, vaultPath },
    settingsSource: settings,
    receiveActiveThreads: (threads) => {
      queryScope.client.setQueryData<ActiveThreadData>(["threads", "active"], {
        pages: [{ threads, nextCursor: null, fetchedSize: threads.length }],
        pageParams: [null],
      });
    },
    threadMutations: threadMutationCommandsMock(overrides.threadMutations),
    threadTitlePort: {
      persistedContext: vi.fn().mockResolvedValue(null),
      generateTitle: vi.fn().mockResolvedValue(null),
    },
    threadAutoTitleWork: { submit: vi.fn() },
    runtimeSettingsCommitQueue: createKeyedOperationCoordinator({ whenBusy: "queue" }),
    settings: chatPanelSettingsAccess(settings),
    workspace: {
      returnFromForkDraft: vi.fn().mockResolvedValue(true),
      openForkDraft: vi.fn(),
      openThreadInNewView: overrides.openThreadInNewView ?? vi.fn(),
      openThreadInAvailableView: overrides.openThreadInAvailableView ?? vi.fn(),
      openThreadFromPanel: overrides.openThreadFromPanel ?? vi.fn(),
      openTurnDiff: overrides.openTurnDiff ?? vi.fn(),
      notifyPanelActivityChanged: overrides.notifyPanelActivityChanged ?? vi.fn(),
    },
    appServerQueries,
    toolInventoryQueries: overrides.toolInventoryQueries ?? {
      snapshot: vi.fn(() => null),
      observe: vi.fn((_threadId, listener) => {
        listener(null);
        return () => undefined;
      }),
      ensure: vi.fn().mockResolvedValue({
        plugins: null,
        pluginsError: null,
        mcpServers: null,
        mcpDiagnostics: [],
        mcpError: null,
      }),
      refresh: vi.fn().mockResolvedValue({
        plugins: null,
        pluginsError: null,
        mcpServers: null,
        mcpDiagnostics: [],
        mcpError: null,
      }),
    },
    threadCatalog,
    threadFacts: replacementPublication.facts,
    threadReplacementPublication: replacementPublication,
  };
}

export interface TestChatViewRuntimeOwner extends ChatViewRuntimeOwner {
  replace(host: CodexChatHost, beforeAttach?: () => void): void;
}

export function chatViewRuntimeOwner(initialHost: CodexChatHost): TestChatViewRuntimeOwner {
  let host = initialHost;
  let view: ChatRuntimeView | null = null;
  return {
    attachChatView: (nextView) => {
      view = nextView;
      nextView.attachRuntime(host);
    },
    replace: (nextHost, beforeAttach) => {
      const cleanup = view?.detachRuntime();
      void cleanup?.catch(() => undefined);
      host = nextHost;
      beforeAttach?.();
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
    view.load();
    tracked.opened = true;
    await onOpen();
  };
  view.onClose = async () => {
    tracked.opened = false;
    try {
      await onClose();
    } finally {
      view.unload();
    }
  };
  createdViews.push(tracked);
  return view;
}
