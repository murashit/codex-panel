// @vitest-environment jsdom

import { FileSystemAdapter } from "obsidian";
import { vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "../../src/constants";
import { createServerDiagnostics } from "../../src/domain/server/diagnostics";
import type { Thread } from "../../src/domain/threads/model";
import type { CodexChatHost } from "../../src/features/chat/host/contracts";
import type { CodexChatView } from "../../src/features/chat/host/view.obsidian";
import { createThreadGoalCoordinator } from "../../src/features/threads/workflows/thread-goal-coordinator";
import type CodexPanelPlugin from "../../src/main";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../src/settings/preferences";
import { createKeyedOperationCoordinator } from "../../src/shared/async/keyed-operation-coordinator";
import { chatPanelSettingsAccess } from "../features/chat/support/settings";
import { threadMutationCommandsMock } from "./thread-mutations";

const { default: CodexPanelPluginClass } = await import("../../src/main");

export async function pluginWithLeaves(
  leaves: TestLeaf[],
  options: { threadsLeaves?: TestLeaf[]; turnDiffLeaves?: TestLeaf[] } = {},
): Promise<CodexPanelPlugin> {
  const adapter = new FileSystemAdapter();
  vi.spyOn(adapter, "getBasePath").mockReturnValue("/vault");
  const plugin = new CodexPanelPluginClass(
    {
      vault: { adapter },
      workspace: {
        getLeavesOfType: vi.fn((type: string) => {
          if (type === VIEW_TYPE_CODEX_PANEL) return leaves;
          if (type === VIEW_TYPE_CODEX_THREADS) return options.threadsLeaves ?? [];
          if (type === VIEW_TYPE_CODEX_TURN_DIFF) return options.turnDiffLeaves ?? [];
          return [];
        }),
        revealLeaf: vi.fn().mockResolvedValue(undefined),
        getRightLeaf: vi.fn(() => null),
        createLeafInParent: vi.fn(() => null),
        getMostRecentLeaf: vi.fn(() => null),
        getActiveViewOfType: vi.fn(() => null),
        ensureSideLeaf: vi.fn(() => Promise.reject(new Error("Unexpected ensureSideLeaf call."))),
        on: vi.fn(() => ({})),
        activeLeaf: null,
        rightSplit: {},
      },
    } as never,
    {} as never,
  );
  plugin.settings = { ...DEFAULT_SETTINGS };
  plugin.vaultPath = "/vault";
  plugin.runtime.initialize();
  return plugin;
}

export async function publishCodexPath(plugin: CodexPanelPlugin, codexPath: string): Promise<void> {
  await plugin.runtime.settingTabHost().publishSettings({ ...plugin.settings, codexPath });
}

export interface TestLeaf {
  view: unknown;
  getViewState: ReturnType<typeof vi.fn>;
  getRoot: ReturnType<typeof vi.fn>;
  parent: object;
  setViewState: ReturnType<typeof vi.fn>;
  loadIfDeferred: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
}

export function leaf(options: { state?: Record<string, unknown> } = {}): TestLeaf {
  return {
    view: null,
    getViewState: vi.fn(() => ({ type: VIEW_TYPE_CODEX_PANEL, state: options.state ?? {} })),
    getRoot: vi.fn(() => ({})),
    parent: {},
    setViewState: vi.fn().mockResolvedValue(undefined),
    loadIfDeferred: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn(),
  };
}

export function chatView(CodexChatViewCtor: typeof CodexChatView, leaf: TestLeaf): CodexChatView {
  const containerEl = document.createElement("div");
  containerEl.createDiv();
  containerEl.createDiv();
  const view = new CodexChatViewCtor(
    {
      ...leaf,
      app: {
        workspace: {
          getActiveFile: vi.fn(() => null),
          getLastOpenFiles: vi.fn(() => []),
          on: vi.fn(() => ({})),
          openLinkText: vi.fn(),
          requestSaveLayout: vi.fn(),
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
          fileToLinktext: vi.fn((_file: unknown, _sourcePath: string) => ""),
          getFileCache: vi.fn(() => null),
        },
      },
      containerEl,
    } as never,
    {
      attachChatView: (runtimeView) => {
        runtimeView.attachRuntime(chatHostFixture());
      },
    },
  );
  const workspace = view.app.workspace as unknown as {
    getActiveViewOfType?: ReturnType<typeof vi.fn>;
  };
  workspace.getActiveViewOfType ??= vi.fn();
  workspace.getActiveViewOfType.mockReturnValue(view);
  return view;
}

function chatHostFixture(): CodexChatHost {
  const settings: CodexPanelSettings = { ...DEFAULT_SETTINGS, codexPath: "codex", sendShortcut: "enter" };
  return {
    appServerConnection: {
      createLease: () => ({
        connect: vi.fn().mockResolvedValue({
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
          userAgent: "codex-test",
        }),
        currentClient: () => null,
        isConnected: () => false,
        disconnect: vi.fn(),
      }),
    },
    appServerContext: { codexPath: settings.codexPath, vaultPath: "/vault" },
    threadMutations: threadMutationCommandsMock(),
    threadTitlePort: {
      persistedContext: vi.fn().mockResolvedValue(null),
      generateTitle: vi.fn().mockResolvedValue(null),
    },
    threadAutoTitleWork: { submit: vi.fn() },
    threadGoalCoordinator: createThreadGoalCoordinator(),
    runtimeSettingsCommitQueue: createKeyedOperationCoordinator({ whenBusy: "queue" }),
    settings: chatPanelSettingsAccess(settings),
    workspace: {
      openThreadInNewView: vi.fn(),
      openThreadInAvailableView: vi.fn(),
      openThreadFromPanel: vi.fn(),
      openTurnDiff: vi.fn(),
      notifyPanelActivityChanged: vi.fn(),
      openSideChat: vi.fn(),
    },
    appServerQueries: {
      metadataSnapshot: vi.fn(() => null),
      metadataDiagnosticsSnapshot: vi.fn(() => createServerDiagnostics()),
      refreshAppServerMetadata: vi.fn(() => Promise.resolve()),
      refreshSkills: vi.fn(() => Promise.resolve()),
      refreshRateLimits: vi.fn(() => Promise.resolve()),
      fetchModels: vi.fn(() => Promise.resolve([])),
      refreshModels: vi.fn(() => Promise.resolve([])),
      observeMetadataResource: vi.fn(() => () => undefined),
    },
    threadCatalog: {
      fetchActiveThreads: vi.fn(() => Promise.resolve([])),
      refreshActiveThreads: vi.fn(() => Promise.resolve([])),
      activeThreadsSnapshot: vi.fn(() => null),
      recentActiveThreadsSnapshot: vi.fn(() => null),
      hasMoreActiveThreads: vi.fn(() => false),
      loadMoreActiveThreads: vi.fn(() => Promise.resolve([])),
      observeActiveThreadsResult: vi.fn(() => () => undefined),
    },
    threadFacts: {
      apply: vi.fn(),
      applyBatch: vi.fn(),
    },
    threadReplacementPublication: {
      begin: vi.fn(() => ({ attach: vi.fn(), finish: vi.fn() })),
      visibleThreadId: vi.fn((_threads, threadId) => threadId),
    },
  };
}

export function threadListClient(fetchThreads: () => Promise<readonly Thread[]>): never {
  return {
    request: async (method: string, params: { sectionId?: string }) => {
      if (method === "threadSection/list") return { data: [{ id: "pinned", name: "Pinned" }], nextCursor: null };
      if (method !== "thread/list") throw new Error(`Unexpected app-server request: ${method}`);
      if (params.sectionId === "pinned") return { data: [], nextCursor: null };
      return { data: await fetchThreads(), nextCursor: null };
    },
  } as never;
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

export function thread(id: string): Thread {
  return {
    id,
    preview: id,
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    canAcceptDirectInput: null,
    provenance: { kind: "interactive" },
  };
}

export function panelSnapshot(overrides: PanelSnapshotFixtureOverrides = {}): ReturnType<CodexChatView["surface"]["openPanelSnapshot"]> {
  const { pendingApprovals, pendingUserInputs, pendingMcpElicitations, ...snapshotOverrides } = overrides;
  const pending = (pendingApprovals ?? 0) + (pendingUserInputs ?? 0) + (pendingMcpElicitations ?? 0) > 0;
  return {
    viewId: "view",
    threadId: "thread",
    turnBusy: false,
    pending,
    hasComposerDraft: false,
    connected: true,
    ...snapshotOverrides,
  };
}

type PanelSnapshotFixtureOverrides = Partial<ReturnType<CodexChatView["surface"]["openPanelSnapshot"]>> & {
  pendingApprovals?: number;
  pendingUserInputs?: number;
  pendingMcpElicitations?: number;
};
