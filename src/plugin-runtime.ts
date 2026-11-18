import type { App } from "obsidian";
import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import type { ThreadFact } from "./domain/threads/facts";
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
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import { CodexThreadsView, type ThreadsRuntimeView, type ThreadsViewRuntimeOwner } from "./features/threads-view/view.obsidian";
import type { TurnDiffViewState } from "./features/turn-diff/model";
import { CodexTurnDiffView } from "./features/turn-diff/view.obsidian";
import type { SettingsResources } from "./settings/application/resources";
import type { SettingsTabHost } from "./settings/host/contracts";
import type { CodexPanelSettings } from "./settings/preferences";
import { OwnerLifetime } from "./shared/async/owner-lifetime";
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

interface ExecutionBinding {
  runtime: CodexExecutionRuntime;
  lifetime: OwnerLifetime;
}

export class CodexPanelRuntime implements ChatViewRuntimeOwner, ThreadsViewRuntimeOwner {
  private readonly panels: WorkspacePanelCoordinator;
  private execution: ExecutionBinding | null = null;
  private readonly workspaceLifetime = new OwnerLifetime();
  private selectionRewriteController: SelectionRewriteCommandController | null = null;

  constructor(private readonly options: CodexPanelRuntimeOptions) {
    this.panels = new WorkspacePanelCoordinator({
      app: options.app,
      workspaceSignal: () => this.workspaceLifetime.signal(),
      refreshThreadsViewLiveState: () => {
        this.refreshThreadsViewLiveState();
      },
    });
  }

  initialize(): void {
    if (this.execution) throw new Error("Codex execution runtime is already initialized.");
    this.workspaceLifetime.activate();
    this.execution = this.createExecutionRuntime(this.options.settingsRef.settings.codexPath);
  }

  reconnectWorkspaceViews(): void {
    this.reattachWorkspaceViews(this.currentExecutionRuntime());
  }

  reset(): void {
    this.selectionRewriteController?.closeAll();
    this.selectionRewriteController = null;
    const executionRuntime = this.execution;
    this.workspaceLifetime.dispose();
    executionRuntime?.lifetime.dispose();
    const viewCleanup = executionRuntime ? this.detachWorkspaceViews() : Promise.resolve();
    this.execution = null;
    executionRuntime?.runtime.dispose();
    void viewCleanup.catch(() => undefined);
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

  async activateThreadsView(): Promise<void> {
    await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_THREADS, "left", {
      active: true,
      reveal: true,
    });
  }

  scheduleWorkspacePanelReconcile(options: { restore?: boolean } = {}): void {
    if (!this.execution) return;
    this.panels.scheduleWorkspacePanelReconcile(options);
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
    const workspace = this.workspaceLifetime.signal();
    return {
      settings: this.options.settingsRef.settings,
      resources: this.currentExecutionRuntime().settingsResources,
      publishSettings: (settings) => this.publishSettings(settings, workspace),
    };
  }

  private async publishSettings(
    settings: CodexPanelSettings,
    workspace: AbortSignal,
  ): Promise<{ replacementResources: SettingsResources | null }> {
    if (!this.workspaceLifetime.isCurrent(workspace)) throw new Error("Workspace runtime reset before saving settings.");
    const previousSettings = { ...this.options.settingsRef.settings };
    const previousRuntime = this.execution;
    await this.options.saveSettings(settings);
    if (!this.workspaceLifetime.isCurrent(workspace)) throw new Error("Workspace runtime reset while saving settings.");
    const codexPathChanged = previousSettings.codexPath !== settings.codexPath;
    let replacementResources: SettingsResources | null = null;
    if (codexPathChanged) {
      if (!previousRuntime || this.execution !== previousRuntime) {
        throw new Error("Codex execution runtime reset while replacing the execution runtime.");
      }
      previousRuntime.lifetime.dispose();
      this.selectionRewriteController?.closeAll();
      const cleanup = this.detachWorkspaceViews();
      void cleanup.catch(() => undefined);
      if (this.execution !== previousRuntime) {
        throw new Error("Codex execution runtime reset while replacing the execution runtime.");
      }
      this.execution = null;
      previousRuntime.runtime.dispose();
      Object.assign(this.options.settingsRef.settings, settings);
      const nextRuntime = this.createExecutionRuntime(settings.codexPath);
      this.execution = nextRuntime;
      this.reattachWorkspaceViews(nextRuntime.runtime);
      replacementResources = nextRuntime.runtime.settingsResources;
    } else {
      Object.assign(this.options.settingsRef.settings, settings);
    }
    if (
      previousSettings.showToolbar !== settings.showToolbar ||
      previousSettings.archiveExportEnabled !== settings.archiveExportEnabled ||
      previousSettings.newConversationsEphemeral !== settings.newConversationsEphemeral
    ) {
      this.refreshChatViewSettings();
    }
    if (previousSettings.archiveExportEnabled !== settings.archiveExportEnabled) this.refreshThreadsViewSettings();
    return { replacementResources };
  }

  private async openTurnDiff(state: TurnDiffViewState): Promise<void> {
    const signal = this.workspaceLifetime.signal();
    const isCurrent = () => !signal.aborted;
    if (!isCurrent()) return;
    const existing = this.options.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.options.app.workspace.getLeaf("tab");
    if (!existing) {
      await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true });
    }
    if (!isCurrent()) return;
    await leaf.loadIfDeferred();
    if (!isCurrent()) return;
    if (leaf.view instanceof CodexTurnDiffView) {
      leaf.view.setDiffPayload(state);
    }
    if (isCurrent()) await this.options.app.workspace.revealLeaf(leaf);
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

  private applyThreadRenamed(threadId: string, name: string | null): void {
    for (const view of this.panels.panelViews()) {
      const surface: ChatSharedThreadSurface = view.surface;
      surface.applyThreadRenamed(threadId, name);
    }
  }

  private applyThreadFacts(facts: readonly ThreadFact[]): void {
    for (const fact of facts) {
      switch (fact.type) {
        case "thread-archived":
        case "thread-deleted":
          this.panels.applyThreadUnavailable(fact.threadId);
          break;
        case "thread-renamed":
          this.applyThreadRenamed(fact.threadId, fact.name);
          break;
      }
    }
  }

  private refreshThreadsViewLiveState(): void {
    if (!this.execution) return;
    for (const view of this.threadsViews()) {
      view.refreshLiveState();
    }
  }

  private openPanelActivities(): readonly ThreadsViewPanelActivity[] {
    return this.panels.getOpenPanelSnapshots().map((snapshot) => ({
      threadId: snapshot.threadId,
      selected: snapshot.lastFocused,
      pending: snapshot.pending,
      unread: snapshot.unread,
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

  private async detachWorkspaceViews(): Promise<void> {
    const chatCleanup = this.chatRuntimeViews().map((view) => view.detachRuntime());
    for (const view of this.threadsViews()) view.detachRuntime();
    await Promise.all(chatCleanup);
  }

  private reattachWorkspaceViews(runtime: CodexExecutionRuntime): void {
    for (const view of this.chatRuntimeViews()) runtime.attachChatView(view);
    for (const view of this.threadsViews()) runtime.attachThreadsView(view);
    this.panels.scheduleWorkspacePanelReconcile();
  }

  private currentExecutionRuntime(): CodexExecutionRuntime {
    if (!this.execution) throw new Error("Codex execution runtime is not initialized.");
    return this.execution.runtime;
  }

  private createExecutionRuntime(codexPath: string): ExecutionBinding {
    const lifetime = new OwnerLifetime();
    const workspaceSignal = this.workspaceLifetime.signal();
    const runtime = new CodexExecutionRuntime({
      app: this.options.app,
      context: { codexPath, vaultPath: this.options.settingsRef.vaultPath },
      settings: () => this.options.settingsRef.settings,
      workspace: {
        ...this.panels.forRuntime(lifetime.signal()),
        openTurnDiff: (state) => (workspaceSignal.aborted ? Promise.resolve() : this.openTurnDiff(state)),
        notifyPanelActivityChanged: () => {
          if (workspaceSignal.aborted) return;
          this.scheduleWorkspacePanelReconcile({ restore: false });
          this.refreshThreadsViewLiveState();
        },
        openNewPanel: () => (workspaceSignal.aborted ? Promise.resolve() : this.panels.openNewPanel()),
        openPanelActivities: () => this.openPanelActivities(),
      },
      onThreadFacts: (facts) => {
        this.applyThreadFacts(facts);
      },
    });
    return { runtime, lifetime };
  }
}
