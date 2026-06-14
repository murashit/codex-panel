import { Plugin } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { registerSelectionRewriteCommand } from "./features/selection-rewrite/command";
import { CodexChatView } from "./features/chat/host/view";
import type { CodexChatHost } from "./features/chat/application/ports/chat-host";
import { CodexChatTurnDiffView } from "./features/chat/ui/turn-diff/view";
import { openThreadPicker, type ThreadPickerHost } from "./features/thread-picker/modal";
import { CodexThreadsView, type CodexThreadsHost } from "./features/threads-view/view";
import { SharedAppServerCache } from "./app-server/services/shared-cache";
import type { SharedAppServerCacheContext } from "./app-server/services/shared-cache-state";
import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData, type CodexPanelSettings } from "./settings/model";
import { CodexPanelSettingTab, type CodexPanelSettingTabHost } from "./settings/tab";
import { persistedChatTurnDiffViewState, type ChatTurnDiffViewState } from "./features/chat/domain/turn-diff";
import { WorkspacePanelCoordinator } from "./workspace/panel-coordinator";
import { createThreadSurfaceActions } from "./workspace/thread-surface-actions";
import type { SharedServerMetadata } from "./domain/server/metadata";
import type { Thread } from "./domain/threads/model";

interface PluginHostServices {
  readonly settingsRef: CodexPanelPlugin;
  readonly app: CodexPanelPlugin["app"];
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  readonly workspace: {
    openThreadInNewView: (threadId: string) => Promise<unknown>;
    focusThreadInOpenView: (threadId: string) => Promise<boolean>;
    openThreadInCurrentView: (threadId: string) => Promise<void>;
    openThreadInAvailableView: (threadId: string) => Promise<void>;
    openNewPanel: () => Promise<unknown>;
    getOpenPanelSnapshots: () => ReturnType<WorkspacePanelCoordinator["getOpenPanelSnapshots"]>;
    openTurnDiff: (state: ChatTurnDiffViewState) => Promise<void>;
  };
  readonly threadSurfaces: {
    notifyThreadArchived: CodexThreadsHost["notifyThreadArchived"];
    notifyThreadRenamed: (threadId: string, name: string | null) => void;
    refreshOpenViews: () => void;
    refreshThreadsViewLiveState: () => void;
    refreshSharedThreadListFromOpenSurface: () => void;
    applyThreadListSnapshot: (threads: readonly Thread[]) => void;
    publishAppServerMetadata: (metadata: SharedServerMetadata) => void;
    publishModels: (models: Parameters<CodexPanelSettingTabHost["publishModels"]>[0]) => void;
  };
  readonly sharedCache: {
    refreshThreadList: (fetchThreads: () => Promise<readonly Thread[]>) => Promise<readonly Thread[]>;
    cachedThreadList: () => readonly Thread[] | null;
    cachedAppServerMetadata: () => SharedServerMetadata | null;
    cachedModels: () => ReturnType<CodexPanelSettingTabHost["cachedModels"]>;
  };
  readonly appServerIdentity: {
    publishAppServerIdentity: (userAgent: string | null) => void;
  };
}

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
  private readonly threadSurfaces = createThreadSurfaceActions({
    app: this.app,
    panels: this.panels,
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

  private applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.sharedAppServerCache.applyThreadListSnapshot(this.sharedAppServerCacheContext(), threads);
    this.threadSurfaces.applyThreadListSnapshot(threads);
  }

  private refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]> {
    return this.sharedAppServerCache.refreshThreadList(this.sharedAppServerCacheContext(), fetchThreads, (threads) => {
      this.threadSurfaces.applyThreadListSnapshot(threads);
    });
  }

  private cachedThreadList(): readonly Thread[] | null {
    return this.sharedAppServerCache.cachedThreadList(this.sharedAppServerCacheContext());
  }

  private publishAppServerMetadata(metadata: SharedServerMetadata): void {
    this.sharedAppServerCache.applyAppServerMetadataSnapshot(this.sharedAppServerCacheContext(), metadata);
    this.threadSurfaces.publishAppServerMetadata(metadata);
  }

  private publishModels(models: Parameters<CodexPanelSettingTabHost["publishModels"]>[0]): void {
    this.sharedAppServerCache.applyModelsSnapshot(this.sharedAppServerCacheContext(), models);
    this.threadSurfaces.publishModels(models);
  }

  private pluginServices(): PluginHostServices {
    return {
      settingsRef: this,
      app: this.app,
      settings: this.settings,
      vaultPath: this.vaultPath,
      workspace: {
        openThreadInNewView: (threadId) => this.panels.openThreadInNewView(threadId),
        focusThreadInOpenView: (threadId) => this.panels.focusThreadInOpenView(threadId),
        openThreadInCurrentView: (threadId) => this.panels.openThreadInCurrentView(threadId),
        openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
        openNewPanel: () => this.panels.openNewPanel(),
        getOpenPanelSnapshots: () => this.panels.getOpenPanelSnapshots(),
        openTurnDiff: (state) => this.openTurnDiff(state),
      },
      threadSurfaces: {
        notifyThreadArchived: (threadId, options) => {
          this.threadSurfaces.notifyThreadArchived(threadId, options);
        },
        notifyThreadRenamed: (threadId, name) => {
          this.threadSurfaces.notifyThreadRenamed(threadId, name);
        },
        refreshOpenViews: () => {
          this.threadSurfaces.refreshOpenViews();
        },
        refreshThreadsViewLiveState: () => {
          this.threadSurfaces.refreshThreadsViewLiveState();
        },
        refreshSharedThreadListFromOpenSurface: () => {
          this.threadSurfaces.refreshSharedThreadListFromOpenSurface();
        },
        applyThreadListSnapshot: (threads) => {
          this.applyThreadListSnapshot(threads);
        },
        publishAppServerMetadata: (metadata) => {
          this.publishAppServerMetadata(metadata);
        },
        publishModels: (models) => {
          this.publishModels(models);
        },
      },
      sharedCache: {
        refreshThreadList: (fetchThreads) => this.refreshThreadList(fetchThreads),
        cachedThreadList: () => this.cachedThreadList(),
        cachedAppServerMetadata: () => this.sharedAppServerCache.cachedAppServerMetadata(this.sharedAppServerCacheContext()),
        cachedModels: () => this.sharedAppServerCache.cachedModels(this.sharedAppServerCacheContext()),
      },
      appServerIdentity: {
        publishAppServerIdentity: (userAgent) => {
          this.publishAppServerIdentity(userAgent);
        },
      },
    };
  }

  private chatHost(): CodexChatHost {
    const services = this.pluginServices();
    return {
      settingsRef: services.settingsRef,
      workspace: {
        openThreadInNewView: services.workspace.openThreadInNewView,
        focusThreadInOpenView: services.workspace.focusThreadInOpenView,
        openTurnDiff: services.workspace.openTurnDiff,
      },
      threadSurfaces: services.threadSurfaces,
      sharedCache: services.sharedCache,
      appServerIdentity: services.appServerIdentity,
    };
  }

  private threadsHost(): CodexThreadsHost {
    const services = this.pluginServices();
    return {
      settings: services.settings,
      vaultPath: services.vaultPath,
      openNewPanel: services.workspace.openNewPanel,
      openThreadInAvailableView: services.workspace.openThreadInAvailableView,
      getOpenPanelSnapshots: services.workspace.getOpenPanelSnapshots,
      notifyThreadArchived: services.threadSurfaces.notifyThreadArchived,
      notifyThreadRenamed: services.threadSurfaces.notifyThreadRenamed,
      publishAppServerIdentity: services.appServerIdentity.publishAppServerIdentity,
      refreshThreadList: services.sharedCache.refreshThreadList,
      cachedThreadList: services.sharedCache.cachedThreadList,
    };
  }

  private threadPickerHost(): ThreadPickerHost {
    const services = this.pluginServices();
    return {
      app: services.app,
      settings: services.settings,
      vaultPath: services.vaultPath,
      cachedThreadList: services.sharedCache.cachedThreadList,
      refreshThreadList: services.sharedCache.refreshThreadList,
      openThreadInCurrentView: services.workspace.openThreadInCurrentView,
      openThreadInAvailableView: services.workspace.openThreadInAvailableView,
    };
  }

  private settingTabHost(): CodexPanelSettingTabHost {
    const services = this.pluginServices();
    return {
      settings: services.settings,
      vaultPath: services.vaultPath,
      saveSettings: () => this.saveSettings(),
      refreshOpenViews: services.threadSurfaces.refreshOpenViews,
      refreshSharedThreadListFromOpenSurface: services.threadSurfaces.refreshSharedThreadListFromOpenSurface,
      cachedModels: services.sharedCache.cachedModels,
      publishModels: services.threadSurfaces.publishModels,
    };
  }
}
