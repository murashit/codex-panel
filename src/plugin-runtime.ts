import type { App } from "obsidian";
import { VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { CodexExecutionRuntime } from "./execution-runtime";
import type {
  ChatRuntimeView,
  ChatSharedThreadSurface,
  ChatViewLifecycleSurface,
  ChatViewRuntimeOwner,
} from "./features/chat/host/contracts";
import type { SelectionRewriteCommandController } from "./features/selection-rewrite/command.obsidian";
import type { SelectionRewriteTransport } from "./features/selection-rewrite/transport";
import type { ThreadLifecycleEvent } from "./features/threads/workflows/thread-operation-event";
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import { CodexThreadsView, type ThreadsRuntimeView, type ThreadsViewRuntimeOwner } from "./features/threads-view/view.obsidian";
import { persistedTurnDiffViewState, type TurnDiffViewState } from "./features/turn-diff/model";
import { CodexTurnDiffView } from "./features/turn-diff/view.obsidian";
import type { SettingsDynamicDataAccess } from "./settings/dynamic-data";
import type { CodexPanelSettingTabHost } from "./settings/host";
import type { CodexPanelSettings } from "./settings/model";
import { WorkspacePanelCoordinator } from "./workspace/panel-coordinator";

interface CodexPanelRuntimeSettingsRef {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
}

export interface CodexPanelRuntimeOptions {
  app: App;
  settingsRef: CodexPanelRuntimeSettingsRef;
  saveSettings(settings: CodexPanelSettings): Promise<void>;
}

export class CodexPanelRuntime implements ChatViewRuntimeOwner, ThreadsViewRuntimeOwner {
  private readonly panels: WorkspacePanelCoordinator;
  private executionRuntime: CodexExecutionRuntime | null = null;
  private selectionRewriteController: SelectionRewriteCommandController | null = null;

  constructor(private readonly options: CodexPanelRuntimeOptions) {
    this.panels = new WorkspacePanelCoordinator({
      app: options.app,
      refreshThreadsViewLiveState: () => {
        this.refreshThreadsViewLiveState();
      },
    });
  }

  initialize(): void {
    if (this.executionRuntime) throw new Error("Codex execution runtime is already initialized.");
    this.executionRuntime = this.createExecutionRuntime(this.options.settingsRef.settings.codexPath);
  }

  reset(): void {
    this.selectionRewriteController?.closeAll();
    this.selectionRewriteController = null;
    const executionRuntime = this.executionRuntime;
    this.executionRuntime = null;
    executionRuntime?.dispose();
    this.panels.reset();
  }

  attachChatView(view: ChatRuntimeView): void {
    this.currentExecutionRuntime().attachChatView(view);
  }

  detachChatView(view: ChatRuntimeView): void {
    this.executionRuntime?.detachChatView(view);
  }

  attachThreadsView(view: ThreadsRuntimeView): void {
    this.currentExecutionRuntime().attachThreadsView(view);
  }

  detachThreadsView(view: ThreadsRuntimeView): void {
    this.executionRuntime?.detachThreadsView(view);
  }

  activeWorkspaceLeafChanged(leaf: Parameters<WorkspacePanelCoordinator["activeLeafChanged"]>[0]): void {
    this.panels.activeLeafChanged(leaf);
  }

  activatePanel(): Promise<unknown> {
    return this.panels.activateView();
  }

  activateNewPanel(): Promise<unknown> {
    return this.panels.activateNewView();
  }

  async startNewChat(): Promise<void> {
    await this.panels.startNewChat();
  }

  openThreadPicker(): void {
    this.currentExecutionRuntime().openThreadPicker();
  }

  async activateThreadsView(): Promise<CodexThreadsView> {
    const leaf = await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_THREADS, "left", {
      active: true,
      reveal: true,
    });
    return leaf.view as CodexThreadsView;
  }

  scheduleWorkspacePanelReconcile(): void {
    this.panels.scheduleWorkspacePanelReconcile();
  }

  cancelWorkspacePanelReconcile(): void {
    this.panels.cancelWorkspacePanelReconcile();
  }

  setSelectionRewriteController(controller: SelectionRewriteCommandController): void {
    this.selectionRewriteController = controller;
  }

  selectionRewriteTransport(): SelectionRewriteTransport {
    return {
      generate: (request) => this.currentExecutionRuntime().selectionRewriteTransport().generate(request),
    };
  }

  settingTabHost(): CodexPanelSettingTabHost {
    return {
      settings: this.options.settingsRef.settings,
      dynamicData: this.currentExecutionRuntime().settingsDynamicData,
      publishSettings: (settings) => this.publishSettings(settings),
    };
  }

  private async publishSettings(settings: CodexPanelSettings): Promise<{ replacementDynamicData: SettingsDynamicDataAccess | null }> {
    const previousSettings = { ...this.options.settingsRef.settings };
    await this.options.saveSettings(settings);
    const appServerContextReplaced = previousSettings.codexPath !== settings.codexPath;
    let replacementDynamicData: SettingsDynamicDataAccess | null = null;
    if (appServerContextReplaced) {
      const nextRuntime = this.createExecutionRuntime(settings.codexPath);
      this.selectionRewriteController?.closeAll();
      this.panels.invalidateRuntimeIntents();
      const previousRuntime = this.executionRuntime;
      this.executionRuntime = null;
      const views = previousRuntime?.dispose() ?? { chat: [], threads: [] };
      Object.assign(this.options.settingsRef.settings, settings);
      nextRuntime.adoptViews(views);
      this.executionRuntime = nextRuntime;
      replacementDynamicData = nextRuntime.settingsDynamicData;
    } else {
      Object.assign(this.options.settingsRef.settings, settings);
    }
    if (previousSettings.showToolbar !== settings.showToolbar || previousSettings.archiveExportEnabled !== settings.archiveExportEnabled) {
      this.refreshChatViewSettings();
    }
    if (previousSettings.archiveExportEnabled !== settings.archiveExportEnabled) this.refreshThreadsViewSettings();
    return { replacementDynamicData };
  }

  private async openTurnDiff(state: TurnDiffViewState): Promise<void> {
    const existing = this.options.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.options.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true, state: { ...persistedTurnDiffViewState(state) } });
    await leaf.loadIfDeferred();
    if (leaf.view instanceof CodexTurnDiffView) {
      leaf.view.setDiffPayload(state);
    }
    await this.options.app.workspace.revealLeaf(leaf);
  }

  private refreshChatViewSettings(): void {
    for (const view of this.panels.panelViews()) {
      const surface: ChatViewLifecycleSurface = view.surface;
      surface.refreshSettings();
    }
  }

  private refreshThreadsViewSettings(): void {
    for (const view of this.threadsViews()) view.refreshSettings();
  }

  private applyThreadArchived(threadId: string): void {
    this.panels.applyThreadArchived(threadId);
  }

  private applyThreadRenamed(threadId: string, name: string | null): void {
    for (const view of this.panels.panelViews()) {
      const surface: ChatSharedThreadSurface = view.surface;
      surface.applyThreadRenamed(threadId, name);
    }
  }

  private applyThreadLifecycleSurfaceEvents(events: readonly ThreadLifecycleEvent[]): void {
    for (const event of events) this.applyThreadLifecycleSurfaceEvent(event);
  }

  private applyThreadLifecycleSurfaceEvent(event: ThreadLifecycleEvent): void {
    switch (event.type) {
      case "thread-archived":
        this.applyThreadArchived(event.threadId);
        return;
      case "thread-renamed":
        this.applyThreadRenamed(event.threadId, event.name);
        return;
      default:
        return;
    }
  }

  private refreshThreadsViewLiveState(): void {
    if (!this.executionRuntime) return;
    for (const view of this.threadsViews()) {
      view.refreshLiveState();
    }
  }

  private openPanelActivities(): readonly ThreadsViewPanelActivity[] {
    return this.panels.getOpenPanelSnapshots().map((snapshot) => ({
      threadId: snapshot.publishedActivity.threadId,
      selected: snapshot.lastFocused,
      pending: snapshot.publishedActivity.pending,
      running: snapshot.publishedActivity.turnBusy,
    }));
  }

  private threadHasPendingOrRunningPanel(threadId: string): boolean {
    return this.panels
      .getOpenPanelSnapshots()
      .some((snapshot) => snapshot.threadId === threadId && (snapshot.turnBusy || snapshot.pending));
  }

  private threadsViews(): CodexThreadsView[] {
    return this.options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .flatMap((leaf) => (leaf.view instanceof CodexThreadsView ? [leaf.view] : []));
  }

  private currentExecutionRuntime(): CodexExecutionRuntime {
    if (!this.executionRuntime) throw new Error("Codex execution runtime is not initialized.");
    return this.executionRuntime;
  }

  private createExecutionRuntime(codexPath: string): CodexExecutionRuntime {
    return new CodexExecutionRuntime({
      app: this.options.app,
      context: { codexPath, vaultPath: this.options.settingsRef.vaultPath },
      settings: () => this.options.settingsRef.settings,
      workspace: {
        openThreadInNewView: (threadId) => this.panels.openThreadInNewView(threadId),
        openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
        openThreadFromPanel: (threadId, originViewId, originSwitchable) =>
          this.panels.openThreadFromPanel(threadId, originViewId, originSwitchable),
        focusThreadInOpenView: (threadId) => this.panels.focusThreadInOpenView(threadId),
        threadHasPendingOrRunningPanel: (threadId) => this.threadHasPendingOrRunningPanel(threadId),
        openTurnDiff: (state) => this.openTurnDiff(state),
        openSideChat: (sourceThreadId, sourceThreadTitle) => this.panels.openSideChat(sourceThreadId, sourceThreadTitle),
        notifyPanelActivityChanged: () => {
          this.refreshThreadsViewLiveState();
        },
      },
      onThreadLifecycleEvents: (events) => {
        this.applyThreadLifecycleSurfaceEvents(events);
      },
      openNewPanel: () => this.panels.openNewPanel(),
      openThreadInCurrentView: (threadId) => this.panels.openThreadInCurrentView(threadId),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
      openPanelActivities: () => this.openPanelActivities(),
    });
  }
}
