// @vitest-environment jsdom

import { FileSystemAdapter } from "obsidian";
import { vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS } from "../../src/constants";
import type { Thread } from "../../src/domain/threads/model";
import type { CodexChatHost } from "../../src/features/chat/host/contracts";
import type { CodexChatView } from "../../src/features/chat/host/view.obsidian";
import { createThreadNameMutationCoordinator } from "../../src/features/threads/workflows/thread-name-mutation-coordinator";
import type CodexPanelPlugin from "../../src/main";
import { type CodexPanelSettings, DEFAULT_SETTINGS } from "../../src/settings/model";
import { chatPanelSettingsAccess } from "../features/chat/support/settings";

export async function pluginWithLeaves(leaves: TestLeaf[], options: { threadsLeaves?: TestLeaf[] } = {}): Promise<CodexPanelPlugin> {
  const { default: CodexPanelPlugin } = await import("../../src/main");
  const adapter = new FileSystemAdapter();
  vi.spyOn(adapter, "getBasePath").mockReturnValue("/vault");
  const plugin = new CodexPanelPlugin(
    {
      vault: { adapter },
      workspace: {
        getLeavesOfType: vi.fn((type: string) => {
          if (type === VIEW_TYPE_CODEX_PANEL) return leaves;
          if (type === VIEW_TYPE_CODEX_THREADS) return options.threadsLeaves ?? [];
          return [];
        }),
        revealLeaf: vi.fn().mockResolvedValue(undefined),
        getRightLeaf: vi.fn(() => null),
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
  return new CodexChatViewCtor(
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
    chatHostFixture(),
  );
}

function chatHostFixture(): CodexChatHost {
  const settings: CodexPanelSettings = { ...DEFAULT_SETTINGS, codexPath: "codex", sendShortcut: "enter" };
  return {
    threadNameMutations: createThreadNameMutationCoordinator(),
    settingsRef: {
      settings: chatPanelSettingsAccess(settings),
      vaultPath: "/vault",
    },
    workspace: {
      openThreadInNewView: vi.fn(),
      focusThreadInOpenView: vi.fn(),
      openTurnDiff: vi.fn(),
      refreshThreadsViewLiveState: vi.fn(),
      openSideChat: vi.fn(),
    },
    appServerQueries: {
      contextLease: () => ({ context: { codexPath: settings.codexPath, vaultPath: "/vault" }, generation: 1 }),
      appServerMetadataSnapshot: vi.fn(() => null),
      refreshAppServerMetadata: vi.fn(() => Promise.resolve(null)),
      refreshSkills: vi.fn(() => Promise.resolve(null)),
      refreshRateLimits: vi.fn(() => Promise.resolve(null)),
      modelsSnapshot: vi.fn(() => null),
      fetchModels: vi.fn(() => Promise.resolve([])),
      refreshModels: vi.fn(() => Promise.resolve([])),
      observeAppServerMetadataResult: vi.fn(() => () => undefined),
      observeModelsResult: vi.fn(() => () => undefined),
    },
    threadCatalog: {
      apply: vi.fn(),
      applyConnectionEvent: vi.fn(),
      loadActive: vi.fn(() => Promise.resolve([])),
      refreshActive: vi.fn(() => Promise.resolve([])),
      activeSnapshot: vi.fn(() => null),
      observeActive: vi.fn(() => () => undefined),
    },
  };
}

export function threadListClient(fetchThreads: () => Promise<readonly Thread[]>): never {
  return {
    request: async (method: string) => {
      if (method !== "thread/list") throw new Error(`Unexpected app-server request: ${method}`);
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
    provenance: { kind: "interactive" },
  };
}

export function panelSnapshot(overrides: PanelSnapshotFixtureOverrides = {}): ReturnType<CodexChatView["surface"]["openPanelSnapshot"]> {
  const { pendingApprovals, pendingUserInputs, pendingMcpElicitations, ...snapshotOverrides } = overrides;
  const pendingRequests = snapshotOverrides.pendingRequests ?? {
    approvals: pendingApprovals ?? 0,
    userInputs: pendingUserInputs ?? 0,
    mcpElicitations: pendingMcpElicitations ?? 0,
    actionable: (pendingApprovals ?? 0) + (pendingUserInputs ?? 0) + (pendingMcpElicitations ?? 0),
  };
  return {
    viewId: "view",
    threadId: "thread",
    turnLifecycle: { kind: "idle" },
    pendingRequests,
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
