import { Plugin, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { registerSelectionRewriteCommand } from "./features/selection-rewrite/command";
import { CodexChatView } from "./features/chat/view";
import { CodexChatTurnDiffView } from "./features/chat/chat-turn-diff-view";
import { openThreadPicker } from "./features/thread-picker/modal";
import type { OpenCodexPanelSnapshot } from "./runtime/open-panel-snapshot";
import { CodexThreadsView } from "./features/threads-view/view";
import type { Thread } from "./generated/app-server/v2/Thread";
import type { Model } from "./generated/app-server/v2/Model";
import {
  applySharedModels,
  applySharedAppServerMetadata,
  applySharedThreadList,
  cachedSharedAppServerMetadata,
  cachedSharedThreadList,
  createSharedAppServerState,
  type SharedAppServerState,
  type SharedAppServerMetadata,
} from "./runtime/shared-app-server-state";
import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData, type CodexPanelSettings } from "./settings/model";
import { CodexPanelSettingTab } from "./settings/tab";
import { persistedChatTurnDiffViewState, type ChatTurnDiffViewState } from "./features/chat/ui/turn-diff";

const BOOT_RESTORED_PANEL_LOAD_DELAY_MS = 1_000;
const BOOT_RESTORED_PANEL_LOAD_STAGGER_MS = 250;

type ThreadPanelTarget =
  | {
      kind: "open";
      leaf: WorkspaceLeaf;
      view: CodexChatView;
    }
  | {
      kind: "restored";
      leaf: WorkspaceLeaf;
    }
  | {
      kind: "restored-reuse";
      leaf: WorkspaceLeaf;
    }
  | {
      kind: "empty";
      leaf: WorkspaceLeaf;
      view: CodexChatView;
    }
  | {
      kind: "reuse";
      leaf: WorkspaceLeaf;
      view: CodexChatView;
    }
  | {
      kind: "new";
    };

type BootRestoredPanelLoadLifecycleState = { kind: "idle" } | { kind: "scheduled"; timers: Set<number> } | { kind: "cancelled" };

type ThreadListRefreshLifecycleState = { kind: "idle" } | { kind: "refreshing"; promise: Promise<readonly Thread[]> };

export default class CodexPanelPlugin extends Plugin {
  settings: CodexPanelSettings = DEFAULT_SETTINGS;
  vaultPath = "";
  private bootRestoredPanelLoadLifecycle: BootRestoredPanelLoadLifecycleState = { kind: "idle" };
  private sharedAppServerState: SharedAppServerState = createSharedAppServerState();
  private threadListRefreshLifecycle: ThreadListRefreshLifecycleState = { kind: "idle" };

  override async onload(): Promise<void> {
    this.bootRestoredPanelLoadLifecycle = { kind: "idle" };
    this.vaultPath = getVaultPath(this.app);
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_PANEL, (leaf) => new CodexChatView(leaf, this));
    this.registerView(VIEW_TYPE_CODEX_TURN_DIFF, (leaf) => new CodexChatTurnDiffView(leaf));
    this.registerView(VIEW_TYPE_CODEX_THREADS, (leaf) => new CodexThreadsView(leaf, this));

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

    this.scheduleBootRestoredPanelLoads();
  }

  override onunload(): void {
    this.cancelBootRestoredPanelLoads();
  }

  async activateView(): Promise<CodexChatView> {
    const target = this.findCurrentThreadPanelTarget();
    if (target) return this.activateThreadPanelTarget(target);

    const leaf = await this.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: true,
      reveal: true,
    });
    const view = leaf.view as CodexChatView;
    await view.connect();
    view.focusComposer();
    return view;
  }

  async activateNewView(options: { connect?: boolean } = {}): Promise<CodexChatView> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view as CodexChatView;
    if (options.connect !== false) await view.connect();
    view.focusComposer();
    return view;
  }

  async openThreadInNewView(threadId: string): Promise<CodexChatView> {
    const view = await this.activateThreadResumeView();
    await view.openThread(threadId);
    return view;
  }

  async openNewPanel(): Promise<void> {
    await this.activateNewView();
  }

  async openThreadInAvailableView(threadId: string): Promise<void> {
    const target = this.findThreadPanelTarget(threadId);
    await this.openThreadInTarget(target, threadId);
  }

  async openThreadInCurrentView(threadId: string): Promise<void> {
    const target =
      this.findOpenThreadPanelTarget(threadId) ?? this.findRestoredThreadPanelTarget(threadId) ?? this.findCurrentThreadPanelTarget();
    await this.openThreadInTarget(target ?? { kind: "new" }, threadId);
  }

  async focusThreadInOpenView(threadId: string): Promise<boolean> {
    const target = this.findOpenThreadPanelTarget(threadId) ?? this.findRestoredThreadPanelTarget(threadId);
    if (!target) return false;

    await this.openThreadInTarget(target, threadId);
    return true;
  }

  async openThreadInIdleEmptyView(threadId: string): Promise<boolean> {
    const target = this.findIdleEmptyThreadPanelTarget();
    if (!target) return false;

    await this.openThreadInTarget(target, threadId);
    return true;
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
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView) {
        leaf.view.refreshSettings();
      }
    }
  }

  refreshSharedThreadListFromOpenSurface(): void {
    const chatView = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_PANEL)
      .map((leaf) => leaf.view)
      .find((view): view is CodexChatView => view instanceof CodexChatView && view.openPanelSnapshot().connected);
    if (chatView) {
      void chatView.refreshSharedThreadList();
      return;
    }

    const threadsView = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .map((leaf) => leaf.view)
      .find((view): view is CodexThreadsView => view instanceof CodexThreadsView);
    if (threadsView) void threadsView.refresh();
  }

  refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]> {
    if (this.threadListRefreshLifecycle.kind === "refreshing") return this.threadListRefreshLifecycle.promise;
    const promise = fetchThreads()
      .then((threads) => {
        this.applyThreadListSnapshot(threads);
        return threads;
      })
      .finally(() => {
        if (this.threadListRefreshLifecycle.kind === "refreshing" && this.threadListRefreshLifecycle.promise === promise) {
          this.threadListRefreshLifecycle = { kind: "idle" };
        }
      });
    this.threadListRefreshLifecycle = { kind: "refreshing", promise };
    return promise;
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.sharedAppServerState = applySharedThreadList(this.sharedAppServerState, threads);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView) {
        leaf.view.applyThreadListSnapshot(threads);
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_THREADS)) {
      if (leaf.view instanceof CodexThreadsView) {
        leaf.view.applyThreadListSnapshot(threads);
      }
    }
  }

  cachedThreadList(): readonly Thread[] | null {
    return cachedSharedThreadList(this.sharedAppServerState);
  }

  publishAppServerMetadata(metadata: SharedAppServerMetadata): void {
    this.sharedAppServerState = applySharedAppServerMetadata(this.sharedAppServerState, metadata);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView) {
        leaf.view.applyAppServerMetadataSnapshot(metadata);
      }
    }
  }

  publishModels(models: Model[]): void {
    this.sharedAppServerState = applySharedModels(this.sharedAppServerState, models);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView) {
        leaf.view.applyAvailableModelsSnapshot(models);
      }
    }
  }

  cachedAppServerMetadata(): SharedAppServerMetadata | null {
    return cachedSharedAppServerMetadata(this.sharedAppServerState);
  }

  cachedModels(): Model[] {
    return [...this.sharedAppServerState.availableModels];
  }

  refreshThreadsViewLiveState(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_THREADS)) {
      if (leaf.view instanceof CodexThreadsView) {
        leaf.view.refreshLiveState();
      }
    }
  }

  notifyThreadArchived(threadId: string, options: { closeOpenPanels?: boolean } = {}): void {
    const leavesToClose = options.closeOpenPanels ? this.panelLeavesForThread(threadId) : [];
    this.notifyOpenPanels((view) => {
      view.notifyThreadArchived(threadId);
    });
    for (const leaf of leavesToClose) {
      leaf.detach();
    }
    this.refreshThreadSurfaces();
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.notifyOpenPanels((view) => {
      view.notifyThreadRenamed(threadId, name);
    });
    this.refreshThreadSurfaces();
  }

  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_PANEL)
      .flatMap((leaf) => (leaf.view instanceof CodexChatView ? [leaf.view.openPanelSnapshot()] : []));
  }

  async focusOpenPanel(viewId: string, threadId: string | null = null): Promise<boolean> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView && leaf.view.openPanelSnapshot().viewId === viewId) {
        await this.app.workspace.revealLeaf(leaf);
        await leaf.view.focusThread(threadId);
        return true;
      }
    }
    return false;
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

  private createRightSidebarTab(): WorkspaceLeaf | null {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL).find((leaf) => leaf.getRoot() === workspace.rightSplit);
    if (!existing) return workspace.getRightLeaf(false);

    return workspace.createLeafInParent(existing.parent, Number.MAX_SAFE_INTEGER);
  }

  private activateThreadResumeView(): Promise<CodexChatView> {
    return this.activateNewView({ connect: false });
  }

  private findThreadPanelTarget(threadId: string): ThreadPanelTarget {
    return (
      this.findOpenThreadPanelTarget(threadId) ??
      this.findRestoredThreadPanelTarget(threadId) ??
      this.findIdleEmptyThreadPanelTarget() ?? { kind: "new" }
    );
  }

  private findOpenThreadPanelTarget(threadId: string): ThreadPanelTarget | null {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (!(leaf.view instanceof CodexChatView)) continue;
      if (leaf.view.openPanelSnapshot().threadId !== threadId) continue;
      return { kind: "open", leaf, view: leaf.view };
    }
    return null;
  }

  private panelLeavesForThread(threadId: string): WorkspaceLeaf[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL).filter((leaf) => {
      if (leaf.view instanceof CodexChatView) return leaf.view.openPanelSnapshot().threadId === threadId;
      return restoredPanelThreadId(leaf) === threadId;
    });
  }

  private findRestoredThreadPanelTarget(threadId: string): ThreadPanelTarget | null {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView) continue;
      if (restoredPanelThreadId(leaf) !== threadId) continue;
      return { kind: "restored", leaf };
    }
    return null;
  }

  private findIdleEmptyThreadPanelTarget(): ThreadPanelTarget | null {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (!(leaf.view instanceof CodexChatView)) continue;
      if (!isIdleEmptyPanelSnapshot(leaf.view.openPanelSnapshot())) continue;
      return { kind: "empty", leaf, view: leaf.view };
    }
    return null;
  }

  private findCurrentThreadPanelTarget(): ThreadPanelTarget | null {
    const { workspace } = this.app;
    const active = this.findActiveThreadPanelTarget();
    if (active) return active;

    const mostRecent = workspace.getMostRecentLeaf(workspace.rightSplit);
    const target = mostRecent ? this.threadPanelTargetFromLeaf(mostRecent) : null;
    if (target) return target;

    for (const leaf of workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      const fallback = this.threadPanelTargetFromLeaf(leaf);
      if (fallback) return fallback;
    }
    return null;
  }

  private findActiveThreadPanelTarget(): ThreadPanelTarget | null {
    const activeView = this.app.workspace.getActiveViewOfType(CodexChatView);
    if (!activeView) return null;

    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view === activeView) return this.threadPanelTargetFromLeaf(leaf);
    }
    return null;
  }

  private threadPanelTargetFromLeaf(leaf: WorkspaceLeaf): ThreadPanelTarget | null {
    if (leaf.view instanceof CodexChatView) return { kind: "reuse", leaf, view: leaf.view };
    if (leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL) return { kind: "restored-reuse", leaf };
    return null;
  }

  private async activateThreadPanelTarget(target: ThreadPanelTarget): Promise<CodexChatView> {
    if (target.kind === "new") return this.activateNewView();

    await this.app.workspace.revealLeaf(target.leaf);
    if ("view" in target) {
      await target.view.connect();
      target.view.focusComposer();
      return target.view;
    }

    await target.leaf.loadIfDeferred();
    if (target.leaf.view instanceof CodexChatView) {
      await target.leaf.view.connect();
      target.leaf.view.focusComposer();
      return target.leaf.view;
    }

    return this.activateNewView();
  }

  private async openThreadInTarget(target: ThreadPanelTarget, threadId: string): Promise<void> {
    switch (target.kind) {
      case "open":
        await this.app.workspace.revealLeaf(target.leaf);
        await target.view.focusThread(threadId);
        return;
      case "restored":
        await this.app.workspace.revealLeaf(target.leaf);
        await target.leaf.loadIfDeferred();
        if (target.leaf.view instanceof CodexChatView) {
          await target.leaf.view.focusThread(threadId);
        }
        return;
      case "restored-reuse":
        await this.app.workspace.revealLeaf(target.leaf);
        await target.leaf.loadIfDeferred();
        if (target.leaf.view instanceof CodexChatView) {
          await target.leaf.view.openThread(threadId);
        }
        return;
      case "empty":
      case "reuse":
        await this.app.workspace.revealLeaf(target.leaf);
        await target.view.openThread(threadId);
        return;
      case "new":
        await this.openThreadInNewView(threadId);
        return;
    }
  }

  private notifyOpenPanels(callback: (view: CodexChatView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView) callback(leaf.view);
    }
  }

  private refreshThreadSurfaces(): void {
    this.refreshSharedThreadListFromOpenSurface();
  }

  private scheduleBootRestoredPanelLoads(): void {
    this.scheduleBootRestoredPanelLoadTimer(() => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL);
      leaves.forEach((leaf, index) => {
        this.scheduleBootRestoredPanelLoadTimer(() => {
          void this.loadRestoredPanelLeaf(leaf);
        }, index * BOOT_RESTORED_PANEL_LOAD_STAGGER_MS);
      });
    }, BOOT_RESTORED_PANEL_LOAD_DELAY_MS);
  }

  private scheduleBootRestoredPanelLoadTimer(callback: () => void, delay: number): void {
    const lifecycle = this.ensureBootRestoredPanelLoadScheduled();
    if (!lifecycle) return;
    const timer = window.setTimeout(() => {
      if (this.bootRestoredPanelLoadLifecycle !== lifecycle) return;
      lifecycle.timers.delete(timer);
      callback();
      if (this.bootRestoredPanelLoadLifecycle === lifecycle && lifecycle.timers.size === 0) {
        this.bootRestoredPanelLoadLifecycle = { kind: "idle" };
      }
    }, delay);
    lifecycle.timers.add(timer);
  }

  private async loadRestoredPanelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (this.bootRestoredPanelLoadLifecycle.kind === "cancelled") return;
    try {
      await leaf.loadIfDeferred();
    } catch (error) {
      console.warn("Codex Panel could not hydrate a restored panel leaf.", error);
    }
  }

  private ensureBootRestoredPanelLoadScheduled(): Extract<BootRestoredPanelLoadLifecycleState, { kind: "scheduled" }> | null {
    if (this.bootRestoredPanelLoadLifecycle.kind === "cancelled") return null;
    if (this.bootRestoredPanelLoadLifecycle.kind === "scheduled") return this.bootRestoredPanelLoadLifecycle;
    const lifecycle: Extract<BootRestoredPanelLoadLifecycleState, { kind: "scheduled" }> = { kind: "scheduled", timers: new Set() };
    this.bootRestoredPanelLoadLifecycle = lifecycle;
    return lifecycle;
  }

  private cancelBootRestoredPanelLoads(): void {
    if (this.bootRestoredPanelLoadLifecycle.kind === "scheduled") {
      for (const timer of this.bootRestoredPanelLoadLifecycle.timers) {
        window.clearTimeout(timer);
      }
      this.bootRestoredPanelLoadLifecycle.timers.clear();
    }
    this.bootRestoredPanelLoadLifecycle = { kind: "cancelled" };
  }
}

function isIdleEmptyPanelSnapshot(snapshot: OpenCodexPanelSnapshot): boolean {
  return (
    snapshot.threadId === null &&
    snapshot.turnLifecycle.kind === "idle" &&
    snapshot.pendingApprovals === 0 &&
    snapshot.pendingUserInputs === 0 &&
    !snapshot.hasComposerDraft
  );
}

function restoredPanelThreadId(leaf: WorkspaceLeaf): string | null {
  const state = leaf.getViewState().state;
  if (!state || typeof state !== "object") return null;
  const threadId = (state as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}
