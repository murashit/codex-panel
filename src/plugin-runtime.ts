import type { App } from "obsidian";
import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { CodexExecutionRuntime } from "./execution-runtime";
import type {
  ChatRuntimeView,
  ChatSharedThreadSurface,
  ChatViewLifecycleSurface,
  ChatViewRuntimeOwner,
} from "./features/chat/host/contracts";
import { CodexChatView } from "./features/chat/host/view.obsidian";
import type { SelectionRewriteCommandController } from "./features/selection-rewrite/command.obsidian";
import type { SelectionRewritePort } from "./features/selection-rewrite/port";
import type { ThreadFact } from "./features/threads/workflows/thread-facts";
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import { CodexThreadsView, type ThreadsRuntimeView, type ThreadsViewRuntimeOwner } from "./features/threads-view/view.obsidian";
import type { TurnDiffViewState } from "./features/turn-diff/model";
import { CodexTurnDiffView } from "./features/turn-diff/view.obsidian";
import type { SettingsResources } from "./settings/application/resources";
import type { SettingsTabHost } from "./settings/host/contracts";
import type { CodexPanelSettings } from "./settings/preferences";
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

  reconnectWorkspaceViews(): void {
    this.reattachWorkspaceViews(this.currentExecutionRuntime());
  }

  reset(): void {
    this.selectionRewriteController?.closeAll();
    this.selectionRewriteController = null;
    const executionRuntime = this.executionRuntime;
    if (executionRuntime) this.detachWorkspaceViews();
    this.executionRuntime = null;
    executionRuntime?.dispose();
    this.panels.reset();
  }

  attachChatView(view: ChatRuntimeView): void {
    this.currentExecutionRuntime().attachChatView(view);
  }

  attachThreadsView(view: ThreadsRuntimeView): void {
    this.currentExecutionRuntime().attachThreadsView(view);
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

  selectionRewritePort(): SelectionRewritePort {
    return {
      generate: (request) => this.currentExecutionRuntime().selectionRewritePort().generate(request),
    };
  }

  settingTabHost(): SettingsTabHost {
    return {
      settings: this.options.settingsRef.settings,
      resources: this.currentExecutionRuntime().settingsResources,
      publishSettings: (settings) => this.publishSettings(settings),
    };
  }

  private async publishSettings(settings: CodexPanelSettings): Promise<{ replacementResources: SettingsResources | null }> {
    const previousSettings = { ...this.options.settingsRef.settings };
    const previousRuntime = this.executionRuntime;
    await this.options.saveSettings(settings);
    const codexPathChanged = previousSettings.codexPath !== settings.codexPath;
    let replacementResources: SettingsResources | null = null;
    if (codexPathChanged) {
      if (!previousRuntime || this.executionRuntime !== previousRuntime) {
        throw new Error("Codex execution runtime reset while replacing the execution runtime.");
      }
      this.selectionRewriteController?.closeAll();
      this.detachWorkspaceViews();
      this.executionRuntime = null;
      previousRuntime.dispose();
      Object.assign(this.options.settingsRef.settings, settings);
      const nextRuntime = this.createExecutionRuntime(settings.codexPath);
      this.executionRuntime = nextRuntime;
      this.reattachWorkspaceViews(nextRuntime);
      replacementResources = nextRuntime.settingsResources;
    } else {
      Object.assign(this.options.settingsRef.settings, settings);
    }
    if (previousSettings.showToolbar !== settings.showToolbar || previousSettings.archiveExportEnabled !== settings.archiveExportEnabled) {
      this.refreshChatViewSettings();
    }
    if (previousSettings.archiveExportEnabled !== settings.archiveExportEnabled) this.refreshThreadsViewSettings();
    return { replacementResources };
  }

  private async openTurnDiff(state: TurnDiffViewState): Promise<void> {
    const existing = this.options.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.options.app.workspace.getLeaf("tab");
    if (!existing) {
      await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true });
    }
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

  private applyThreadUnavailable(threadId: string): void {
    this.panels.applyThreadUnavailable(threadId);
  }

  private applyThreadRenamed(threadId: string, name: string | null): void {
    for (const view of this.panels.panelViews()) {
      const surface: ChatSharedThreadSurface = view.surface;
      surface.applyThreadRenamed(threadId, name);
    }
  }

  private applyThreadFacts(facts: readonly ThreadFact[]): void {
    for (const fact of facts) this.applyThreadFact(fact);
  }

  private applyThreadFact(fact: ThreadFact): void {
    switch (fact.type) {
      case "thread-archived":
      case "thread-deleted":
        this.applyThreadUnavailable(fact.threadId);
        return;
      case "thread-renamed":
        this.applyThreadRenamed(fact.threadId, fact.name);
        return;
      case "thread-pinned":
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
      threadId: snapshot.threadId,
      selected: snapshot.lastFocused,
      pending: snapshot.pending,
      running: snapshot.turnBusy,
    }));
  }

  private threadsViews(): CodexThreadsView[] {
    return this.options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .flatMap((leaf) => (leaf.view instanceof CodexThreadsView ? [leaf.view] : []));
  }

  private chatRuntimeViews(): ChatRuntimeView[] {
    return this.options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_PANEL)
      .flatMap((leaf) => (leaf.view instanceof CodexChatView ? [leaf.view] : []));
  }

  private detachWorkspaceViews(): void {
    for (const view of this.chatRuntimeViews()) view.detachRuntime();
    for (const view of this.threadsViews()) view.detachRuntime();
  }

  private reattachWorkspaceViews(runtime: CodexExecutionRuntime): void {
    for (const view of this.chatRuntimeViews()) runtime.attachChatView(view);
    for (const view of this.threadsViews()) runtime.attachThreadsView(view);
    this.panels.scheduleWorkspacePanelReconcile();
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
        openThreadInNewView: (threadId, displaySnapshot) => this.panels.openThreadInNewView(threadId, displaySnapshot),
        openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
        openThreadFromPanel: (threadId, originViewId, originSwitchable) =>
          this.panels.openThreadFromPanel(threadId, originViewId, originSwitchable),
        openTurnDiff: (state) => this.openTurnDiff(state),
        openSideChat: (sourceThreadId, sourceThreadTitle, initialMessage) =>
          this.panels.openSideChat(sourceThreadId, sourceThreadTitle, initialMessage),
        notifyPanelActivityChanged: () => {
          this.refreshThreadsViewLiveState();
        },
        openNewPanel: () => this.panels.openNewPanel(),
        openThreadInCurrentView: (threadId) => this.panels.openThreadInCurrentView(threadId),
        openPanelActivities: () => this.openPanelActivities(),
      },
      onThreadFacts: (facts) => {
        this.applyThreadFacts(facts);
      },
    });
  }
}
