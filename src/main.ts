import { Plugin } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { registerSelectionRewriteCommand } from "./features/selection-rewrite/command";
import { CodexChatView } from "./features/chat/view";
import type { CodexChatHost } from "./features/chat/chat-host";
import { CodexChatTurnDiffView } from "./features/chat/turn-diff/view";
import { openThreadPicker, type ThreadPickerHost } from "./features/thread-picker/modal";
import { CodexThreadsView, type CodexThreadsHost } from "./features/threads-view/view";
import { SharedAppServerCache } from "./app-server/shared-cache";
import type { SharedAppServerCacheContext } from "./app-server/shared-cache-state";
import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData, type CodexPanelSettings } from "./settings/model";
import { CodexPanelSettingTab, type CodexPanelSettingTabHost } from "./settings/tab";
import { persistedChatTurnDiffViewState, type ChatTurnDiffViewState } from "./features/chat/turn-diff/model";
import { WorkspacePanelCoordinator } from "./workspace/panel-coordinator";
import { ThreadSurfaceCoordinator } from "./workspace/thread-surface-coordinator";

export default class CodexPanelPlugin extends Plugin {
  settings: CodexPanelSettings = DEFAULT_SETTINGS;
  vaultPath = "";
  private appServerUserAgent: string | null = null;
  private readonly sharedAppServerCache = new SharedAppServerCache();
  private readonly panels = new WorkspacePanelCoordinator({
    app: this.app,
    refreshThreadsViewLiveState: () => {
      this.threadSurfaces.refreshThreadsViewLiveState();
    },
  });
  private readonly threadSurfaces = new ThreadSurfaceCoordinator({
    app: this.app,
    panels: this.panels,
    refreshThreadSurfaces: () => {
      this.threadSurfaces.refreshSharedThreadListFromOpenSurface();
    },
  });

  override async onload(): Promise<void> {
    this.panels.reset();
    this.vaultPath = getVaultPath(this.app);
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_PANEL, (leaf) => new CodexChatView(leaf, this.chatHost()));
    this.registerView(VIEW_TYPE_CODEX_TURN_DIFF, (leaf) => new CodexChatTurnDiffView(leaf));
    this.registerView(VIEW_TYPE_CODEX_THREADS, (leaf) => new CodexThreadsView(leaf, this.threadsHost()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.panels.recordLastFocusedPanel(leaf);
      }),
    );

    this.addRibbonIcon("bot-message-square", "Open panel", () => {
      void this.panels.activateView();
    });

    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => void this.panels.activateView(),
    });

    this.addCommand({
      id: "open-new-panel",
      name: "Open new panel",
      callback: () => void this.panels.activateNewView(),
    });

    this.addCommand({
      id: "open-threads-view",
      name: "Open threads view",
      callback: () => void this.activateThreadsView(),
    });

    this.addCommand({
      id: "open-thread",
      name: "Open thread...",
      callback: () => void openThreadPicker(this.threadPickerHost()),
    });

    this.addCommand({
      id: "new-chat",
      name: "Start new chat",
      callback: async () => {
        const view = await this.panels.activateView();
        await view.startNewThread();
      },
    });

    registerSelectionRewriteCommand(this);

    this.addSettingTab(new CodexPanelSettingTab(this.app, this, this.settingTabHost()));

    this.panels.scheduleBootRestoredPanelLoads();
  }

  override onunload(): void {
    this.panels.cancelBootRestoredPanelLoads();
  }

  private async activateThreadsView(): Promise<CodexThreadsView> {
    const leaf = await this.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_THREADS, "left", {
      active: true,
      reveal: true,
    });
    const view = leaf.view as CodexThreadsView;
    await view.refresh();
    return view;
  }

  private async openTurnDiff(state: ChatTurnDiffViewState): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true, state: { ...persistedChatTurnDiffViewState(state) } });
    await leaf.loadIfDeferred();
    if (leaf.view instanceof CodexChatTurnDiffView) {
      leaf.view.setDiffPayload(state);
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const data: unknown = await this.loadData();
    this.settings = normalizeSettings(data);
    if (!settingsMatchNormalizedData(data, this.settings)) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private sharedAppServerCacheContext(): SharedAppServerCacheContext {
    return {
      codexPath: this.settings.codexPath,
      vaultPath: this.vaultPath,
      appServerUserAgent: this.appServerUserAgent,
    };
  }

  private publishAppServerIdentity(userAgent: string | null): void {
    this.appServerUserAgent = userAgent;
  }

  private chatHost(): CodexChatHost {
    return {
      settings: this.settings,
      vaultPath: this.vaultPath,
      openThreadInNewView: (threadId) => this.panels.openThreadInNewView(threadId),
      focusThreadInOpenView: (threadId) => this.panels.focusThreadInOpenView(threadId),
      openTurnDiff: (state) => this.openTurnDiff(state),
      notifyThreadArchived: (threadId) => {
        this.threadSurfaces.notifyThreadArchived(threadId);
      },
      notifyThreadRenamed: (threadId, name) => {
        this.threadSurfaces.notifyThreadRenamed(threadId, name);
      },
      refreshThreadsViewLiveState: () => {
        this.threadSurfaces.refreshThreadsViewLiveState();
      },
      refreshSharedThreadListFromOpenSurface: () => {
        this.threadSurfaces.refreshSharedThreadListFromOpenSurface();
      },
      applyThreadListSnapshot: (threads) => {
        this.sharedAppServerCache.applyThreadListSnapshot(this.sharedAppServerCacheContext(), threads);
        this.threadSurfaces.applyThreadListSnapshot(threads);
      },
      refreshThreadList: (fetchThreads) =>
        this.sharedAppServerCache.refreshThreadList(this.sharedAppServerCacheContext(), fetchThreads, (threads) => {
          this.threadSurfaces.applyThreadListSnapshot(threads);
        }),
      cachedThreadList: () => this.sharedAppServerCache.cachedThreadList(this.sharedAppServerCacheContext()),
      publishAppServerMetadata: (metadata) => {
        this.sharedAppServerCache.applyAppServerMetadataSnapshot(this.sharedAppServerCacheContext(), metadata);
        this.threadSurfaces.publishAppServerMetadata(metadata);
      },
      publishAppServerIdentity: (userAgent) => {
        this.publishAppServerIdentity(userAgent);
      },
      cachedAppServerMetadata: () => this.sharedAppServerCache.cachedAppServerMetadata(this.sharedAppServerCacheContext()),
    };
  }

  private threadsHost(): CodexThreadsHost {
    return {
      settings: this.settings,
      vaultPath: this.vaultPath,
      openNewPanel: () => this.panels.openNewPanel(),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
      getOpenPanelSnapshots: () => this.panels.getOpenPanelSnapshots(),
      notifyThreadArchived: (threadId, options) => {
        this.threadSurfaces.notifyThreadArchived(threadId, options);
      },
      notifyThreadRenamed: (threadId, name) => {
        this.threadSurfaces.notifyThreadRenamed(threadId, name);
      },
      publishAppServerIdentity: (userAgent) => {
        this.publishAppServerIdentity(userAgent);
      },
      refreshThreadList: (fetchThreads) =>
        this.sharedAppServerCache.refreshThreadList(this.sharedAppServerCacheContext(), fetchThreads, (threads) => {
          this.threadSurfaces.applyThreadListSnapshot(threads);
        }),
      cachedThreadList: () => this.sharedAppServerCache.cachedThreadList(this.sharedAppServerCacheContext()),
    };
  }

  private threadPickerHost(): ThreadPickerHost {
    return {
      app: this.app,
      settings: this.settings,
      vaultPath: this.vaultPath,
      cachedThreadList: () => this.sharedAppServerCache.cachedThreadList(this.sharedAppServerCacheContext()),
      refreshThreadList: (fetchThreads) =>
        this.sharedAppServerCache.refreshThreadList(this.sharedAppServerCacheContext(), fetchThreads, (threads) => {
          this.threadSurfaces.applyThreadListSnapshot(threads);
        }),
      openThreadInCurrentView: (threadId) => this.panels.openThreadInCurrentView(threadId),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
    };
  }

  private settingTabHost(): CodexPanelSettingTabHost {
    return {
      settings: this.settings,
      vaultPath: this.vaultPath,
      saveSettings: () => this.saveSettings(),
      refreshOpenViews: () => {
        this.threadSurfaces.refreshOpenViews();
      },
      refreshSharedThreadListFromOpenSurface: () => {
        this.threadSurfaces.refreshSharedThreadListFromOpenSurface();
      },
      cachedModels: () => this.sharedAppServerCache.cachedModels(this.sharedAppServerCacheContext()),
      publishModels: (models) => {
        this.sharedAppServerCache.applyModelsSnapshot(this.sharedAppServerCacheContext(), models);
        this.threadSurfaces.publishModels(models);
      },
    };
  }
}
