import { Plugin } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { registerSelectionRewriteCommand } from "./features/selection-rewrite/command";
import { CodexChatView } from "./features/chat/view";
import { CodexChatTurnDiffView } from "./features/chat/chat-turn-diff-view";
import { openThreadPicker } from "./features/thread-picker/modal";
import type { OpenCodexPanelSnapshot } from "./runtime/open-panel-snapshot";
import { CodexThreadsView } from "./features/threads-view/view";
import type { Thread } from "./generated/app-server/v2/Thread";
import type { Model } from "./generated/app-server/v2/Model";
import type { SharedAppServerMetadata } from "./runtime/shared-app-server-state";
import { SharedAppServerCache } from "./runtime/shared-app-server-cache";
import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData, type CodexPanelSettings } from "./settings/model";
import { CodexPanelSettingTab } from "./settings/tab";
import { persistedChatTurnDiffViewState, type ChatTurnDiffViewState } from "./features/chat/ui/turn-diff";
import { WorkspacePanelCoordinator } from "./workspace/panel-coordinator";
import { ThreadSurfaceCoordinator } from "./workspace/thread-surface-coordinator";

export default class CodexPanelPlugin extends Plugin {
  settings: CodexPanelSettings = DEFAULT_SETTINGS;
  vaultPath = "";
  private readonly sharedAppServerCache = new SharedAppServerCache();
  private readonly panels = new WorkspacePanelCoordinator({
    app: this.app,
    refreshThreadsViewLiveState: () => {
      this.refreshThreadsViewLiveState();
    },
  });
  private readonly threadSurfaces = new ThreadSurfaceCoordinator({
    app: this.app,
    panels: this.panels,
    refreshThreadSurfaces: () => {
      this.refreshSharedThreadListFromOpenSurface();
    },
  });

  override async onload(): Promise<void> {
    this.panels.reset();
    this.vaultPath = getVaultPath(this.app);
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_PANEL, (leaf) => new CodexChatView(leaf, this));
    this.registerView(VIEW_TYPE_CODEX_TURN_DIFF, (leaf) => new CodexChatTurnDiffView(leaf));
    this.registerView(VIEW_TYPE_CODEX_THREADS, (leaf) => new CodexThreadsView(leaf, this));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.panels.recordLastFocusedPanel(leaf);
      }),
    );

    this.addRibbonIcon("bot-message-square", "Open panel", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "open-new-panel",
      name: "Open new panel",
      callback: () => void this.activateNewView(),
    });

    this.addCommand({
      id: "open-threads-view",
      name: "Open threads view",
      callback: () => void this.activateThreadsView(),
    });

    this.addCommand({
      id: "open-thread",
      name: "Open thread...",
      callback: () => void openThreadPicker(this),
    });

    this.addCommand({
      id: "new-chat",
      name: "Start new chat",
      callback: async () => {
        const view = await this.activateView();
        await view.startNewThread();
      },
    });

    registerSelectionRewriteCommand(this);

    this.addSettingTab(new CodexPanelSettingTab(this.app, this));

    this.panels.scheduleBootRestoredPanelLoads();
  }

  override onunload(): void {
    this.panels.cancelBootRestoredPanelLoads();
  }

  async activateView(): Promise<CodexChatView> {
    return this.panels.activateView();
  }

  async activateNewView(options: { connect?: boolean } = {}): Promise<CodexChatView> {
    return this.panels.activateNewView(options);
  }

  async openThreadInNewView(threadId: string): Promise<CodexChatView> {
    return this.panels.openThreadInNewView(threadId);
  }

  async openNewPanel(): Promise<void> {
    await this.panels.openNewPanel();
  }

  async openThreadInAvailableView(threadId: string): Promise<void> {
    await this.panels.openThreadInAvailableView(threadId);
  }

  async openThreadInCurrentView(threadId: string): Promise<void> {
    await this.panels.openThreadInCurrentView(threadId);
  }

  async focusThreadInOpenView(threadId: string): Promise<boolean> {
    return this.panels.focusThreadInOpenView(threadId);
  }

  async openThreadInIdleEmptyView(threadId: string): Promise<boolean> {
    return this.panels.openThreadInIdleEmptyView(threadId);
  }

  async activateThreadsView(): Promise<CodexThreadsView> {
    const leaf = await this.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_THREADS, "left", {
      active: true,
      reveal: true,
    });
    const view = leaf.view as CodexThreadsView;
    await view.refresh();
    return view;
  }

  async openTurnDiff(state: ChatTurnDiffViewState): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true, state: { ...persistedChatTurnDiffViewState(state) } });
    await leaf.loadIfDeferred();
    if (leaf.view instanceof CodexChatTurnDiffView) {
      leaf.view.setDiffPayload(state);
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  refreshOpenViews(): void {
    this.threadSurfaces.refreshOpenViews();
  }

  refreshSharedThreadListFromOpenSurface(): void {
    this.threadSurfaces.refreshSharedThreadListFromOpenSurface();
  }

  refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]> {
    return this.sharedAppServerCache.refreshThreadList(fetchThreads, (threads) => {
      this.threadSurfaces.applyThreadListSnapshot(threads);
    });
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.sharedAppServerCache.applyThreadListSnapshot(threads);
    this.threadSurfaces.applyThreadListSnapshot(threads);
  }

  cachedThreadList(): readonly Thread[] | null {
    return this.sharedAppServerCache.cachedThreadList();
  }

  publishAppServerMetadata(metadata: SharedAppServerMetadata): void {
    this.sharedAppServerCache.applyAppServerMetadataSnapshot(metadata);
    this.threadSurfaces.publishAppServerMetadata(metadata);
  }

  publishModels(models: readonly Model[]): void {
    this.sharedAppServerCache.applyModelsSnapshot(models);
    this.threadSurfaces.publishModels(models);
  }

  cachedAppServerMetadata(): SharedAppServerMetadata | null {
    return this.sharedAppServerCache.cachedAppServerMetadata();
  }

  cachedModels(): Model[] {
    return this.sharedAppServerCache.cachedModels();
  }

  refreshThreadsViewLiveState(): void {
    this.threadSurfaces.refreshThreadsViewLiveState();
  }

  notifyThreadArchived(threadId: string, options: { closeOpenPanels?: boolean } = {}): void {
    this.threadSurfaces.notifyThreadArchived(threadId, options);
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.threadSurfaces.notifyThreadRenamed(threadId, name);
  }

  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[] {
    return this.panels.getOpenPanelSnapshots();
  }

  async focusOpenPanel(viewId: string, threadId: string | null = null): Promise<boolean> {
    return this.panels.focusOpenPanel(viewId, threadId);
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
}
