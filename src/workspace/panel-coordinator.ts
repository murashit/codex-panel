import type { App, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../constants";
import { hasPendingRequests, pendingRequestCounts } from "../domain/pending-requests/aggregate";
import type { ChatWorkspacePanelSnapshot, ChatWorkspacePanelSurface } from "../features/chat/host/contracts";
import { CodexChatView } from "../features/chat/host/view.obsidian";

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

type WorkspacePanelReconcileScheduleState = { kind: "idle" } | { kind: "scheduled"; timers: Set<number> } | { kind: "cancelled" };

interface WorkspacePanelReconcileOptions {
  loadRestoredLeaves?: boolean;
}

const ignoreWorkspacePanelLoadError = (): void => undefined;

export interface WorkspacePanelSnapshot extends ChatWorkspacePanelSnapshot {
  lastFocused: boolean;
}

export interface WorkspacePanelCoordinatorOptions {
  app: App;
  refreshThreadsViewLiveState: () => void;
}

export class WorkspacePanelCoordinator {
  private workspacePanelReconcileSchedule: WorkspacePanelReconcileScheduleState = { kind: "idle" };
  private lastFocusedPanelViewId: string | null = null;

  constructor(private readonly options: WorkspacePanelCoordinatorOptions) {}

  reset(): void {
    this.clearWorkspacePanelReconcileTimers();
    this.workspacePanelReconcileSchedule = { kind: "idle" };
    this.lastFocusedPanelViewId = null;
  }

  async activateView(): Promise<CodexChatView> {
    const target = this.findCurrentThreadPanelTarget();
    if (target) return this.activateThreadPanelTarget(target);

    const leaf = await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: true,
      reveal: true,
    });
    const view = leaf.view as CodexChatView;
    const surface = workspacePanelSurface(view);
    await surface.connect();
    surface.focusComposer();
    return view;
  }

  async activateNewView(options: { connect?: boolean; state?: Record<string, unknown> } = {}): Promise<CodexChatView> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true, ...(options.state ? { state: options.state } : {}) });
    await this.options.app.workspace.revealLeaf(leaf);
    const view = leaf.view as CodexChatView;
    const surface = workspacePanelSurface(view);
    if (options.connect !== false) await surface.connect();
    surface.focusComposer();
    return view;
  }

  async openThreadInNewView(threadId: string): Promise<void> {
    const view = await this.activateThreadResumeView();
    await workspacePanelSurface(view).openThread(threadId);
  }

  async openSideChat(sourceThreadId: string, sourceThreadTitle: string | null): Promise<void> {
    const view = await this.activateNewView({
      connect: false,
      state: { version: 2, ephemeralSource: { threadId: sourceThreadId, title: sourceThreadTitle } },
    });
    await workspacePanelSurface(view).openSideChat({ sourceThreadId, sourceThreadTitle });
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

  getOpenPanelSnapshots(): WorkspacePanelSnapshot[] {
    const leaves = this.panelLeaves();
    this.ensureInitialFocusedPanel(leaves);
    return leaves.flatMap((leaf, index) => {
      if (leaf.view instanceof CodexChatView)
        return [this.openPanelSnapshotWithFocus(workspacePanelSurface(leaf.view).openPanelSnapshot())];
      const restoredSnapshot = restoredPanelSnapshot(leaf, index);
      return restoredSnapshot ? [restoredSnapshot] : [];
    });
  }

  async focusOpenPanel(viewId: string, threadId: string | null = null): Promise<boolean> {
    for (const leaf of this.panelLeaves()) {
      if (leaf.view instanceof CodexChatView && workspacePanelSurface(leaf.view).openPanelSnapshot().viewId === viewId) {
        await this.options.app.workspace.revealLeaf(leaf);
        await workspacePanelSurface(leaf.view).focusThread(threadId);
        return true;
      }
    }
    return false;
  }

  panelLeavesForThread(threadId: string): WorkspaceLeaf[] {
    return this.panelLeaves().filter((leaf) => {
      if (leaf.view instanceof CodexChatView) return workspacePanelSurface(leaf.view).openPanelSnapshot().threadId === threadId;
      return restoredThreadId(leaf) === threadId;
    });
  }

  panelViews(): CodexChatView[] {
    return this.panelLeaves().flatMap((leaf) => (leaf.view instanceof CodexChatView ? [leaf.view] : []));
  }

  reconcileWorkspacePanels(hintLeaf: WorkspaceLeaf | null = null, options: WorkspacePanelReconcileOptions = {}): void {
    const leaves = this.panelLeaves();
    const foregroundLeaf = this.foregroundPanelLeaf(leaves, hintLeaf);
    if (foregroundLeaf) {
      void this.hydratePanelLeaf(foregroundLeaf).catch(ignoreWorkspacePanelLoadError);
    }

    if (options.loadRestoredLeaves) {
      for (const leaf of leaves) {
        if (leaf === foregroundLeaf) continue;
        void this.loadRestoredPanelLeaf(leaf);
      }
      this.options.refreshThreadsViewLiveState();
    }
  }

  scheduleWorkspacePanelReconcile(): void {
    this.scheduleWorkspacePanelReconcileTimer(() => {
      this.reconcileWorkspacePanels(null, { loadRestoredLeaves: true });
    }, 0);
  }

  cancelWorkspacePanelReconcile(): void {
    this.clearWorkspacePanelReconcileTimers();
    this.workspacePanelReconcileSchedule = { kind: "cancelled" };
  }

  private recordLastFocusedPanel(leaf: WorkspaceLeaf | null): void {
    const viewId = focusedPanelViewId(leaf);
    if (!viewId) return;
    if (this.lastFocusedPanelViewId === viewId) return;
    this.lastFocusedPanelViewId = viewId;
    this.options.refreshThreadsViewLiveState();
  }

  private clearWorkspacePanelReconcileTimers(): void {
    if (this.workspacePanelReconcileSchedule.kind === "scheduled") {
      for (const timer of this.workspacePanelReconcileSchedule.timers) {
        window.clearTimeout(timer);
      }
      this.workspacePanelReconcileSchedule.timers.clear();
    }
  }

  private panelLeaves(): WorkspaceLeaf[] {
    return this.options.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL);
  }

  private createRightSidebarTab(): WorkspaceLeaf | null {
    const { workspace } = this.options.app;
    const existing = this.panelLeaves().find((leaf) => leaf.getRoot() === workspace.rightSplit);
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
    for (const leaf of this.panelLeaves()) {
      if (!(leaf.view instanceof CodexChatView)) continue;
      if (workspacePanelSurface(leaf.view).openPanelSnapshot().threadId !== threadId) continue;
      return { kind: "open", leaf, view: leaf.view };
    }
    return null;
  }

  private findRestoredThreadPanelTarget(threadId: string): ThreadPanelTarget | null {
    for (const leaf of this.panelLeaves()) {
      if (leaf.view instanceof CodexChatView) continue;
      if (restoredThreadId(leaf) !== threadId) continue;
      return { kind: "restored", leaf };
    }
    return null;
  }

  private findIdleEmptyThreadPanelTarget(): ThreadPanelTarget | null {
    for (const leaf of this.panelLeaves()) {
      if (!(leaf.view instanceof CodexChatView)) continue;
      if (!isIdleEmptyPanelSnapshot(workspacePanelSurface(leaf.view).openPanelSnapshot())) continue;
      return { kind: "empty", leaf, view: leaf.view };
    }
    return null;
  }

  private findCurrentThreadPanelTarget(): ThreadPanelTarget | null {
    const { workspace } = this.options.app;
    const active = this.findActiveThreadPanelTarget();
    if (active) return active;

    const mostRecent = workspace.getMostRecentLeaf(workspace.rightSplit);
    const target = mostRecent ? this.threadPanelTargetFromLeaf(mostRecent) : null;
    if (target) return target;

    for (const leaf of this.panelLeaves()) {
      const fallback = this.threadPanelTargetFromLeaf(leaf);
      if (fallback) return fallback;
    }
    return null;
  }

  private findActiveThreadPanelTarget(): ThreadPanelTarget | null {
    const activeView = this.options.app.workspace.getActiveViewOfType(CodexChatView);
    if (!activeView) return null;

    for (const leaf of this.panelLeaves()) {
      if (leaf.view === activeView) return this.threadPanelTargetFromLeaf(leaf);
    }
    return null;
  }

  private foregroundPanelLeaf(leaves: readonly WorkspaceLeaf[], hintLeaf: WorkspaceLeaf | null): WorkspaceLeaf | null {
    return (
      this.panelLeafFromLeaf(leaves, hintLeaf) ??
      this.activePanelLeaf(leaves) ??
      this.panelLeafFromLeaf(leaves, this.options.app.workspace.getMostRecentLeaf(this.options.app.workspace.rightSplit))
    );
  }

  private activePanelLeaf(leaves: readonly WorkspaceLeaf[]): WorkspaceLeaf | null {
    const activeView = this.options.app.workspace.getActiveViewOfType(CodexChatView);
    if (!activeView) return null;
    return leaves.find((leaf) => leaf.view === activeView) ?? null;
  }

  private panelLeafFromLeaf(leaves: readonly WorkspaceLeaf[], leaf: WorkspaceLeaf | null): WorkspaceLeaf | null {
    if (!leaf || !leaves.includes(leaf)) return null;
    if (leaf.view instanceof CodexChatView) return leaf;
    return leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL ? leaf : null;
  }

  private threadPanelTargetFromLeaf(leaf: WorkspaceLeaf): ThreadPanelTarget | null {
    if (leaf.view instanceof CodexChatView) return { kind: "reuse", leaf, view: leaf.view };
    if (leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL) return { kind: "restored-reuse", leaf };
    return null;
  }

  private async activateThreadPanelTarget(target: ThreadPanelTarget): Promise<CodexChatView> {
    if (target.kind === "new") return this.activateNewView();

    await this.options.app.workspace.revealLeaf(target.leaf);
    if ("view" in target) {
      const surface = workspacePanelSurface(target.view);
      await surface.connect();
      await surface.focusThread();
      return target.view;
    }

    await target.leaf.loadIfDeferred();
    if (target.leaf.view instanceof CodexChatView) {
      const surface = workspacePanelSurface(target.leaf.view);
      await surface.connect();
      await surface.focusThread();
      return target.leaf.view;
    }

    return this.activateNewView();
  }

  private async openThreadInTarget(target: ThreadPanelTarget, threadId: string): Promise<void> {
    switch (target.kind) {
      case "open":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await workspacePanelSurface(target.view).focusThread(threadId);
        return;
      case "restored":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await target.leaf.loadIfDeferred();
        if (target.leaf.view instanceof CodexChatView) {
          await workspacePanelSurface(target.leaf.view).focusThread(threadId);
        } else {
          await this.openThreadInNewView(threadId);
        }
        return;
      case "restored-reuse":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await target.leaf.loadIfDeferred();
        if (target.leaf.view instanceof CodexChatView) {
          await workspacePanelSurface(target.leaf.view).openThread(threadId);
        } else {
          await this.openThreadInNewView(threadId);
        }
        return;
      case "empty":
      case "reuse":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await workspacePanelSurface(target.view).openThread(threadId);
        return;
      case "new":
        await this.openThreadInNewView(threadId);
        return;
    }
  }

  private ensureInitialFocusedPanel(leaves: readonly WorkspaceLeaf[]): void {
    if (this.lastFocusedPanelViewId) return;
    const activeView = this.options.app.workspace.getActiveViewOfType(CodexChatView);
    const activeLeaf = activeView ? (leaves.find((leaf) => leaf.view === activeView) ?? null) : null;
    const viewId =
      focusedPanelViewId(activeLeaf) ??
      focusedPanelViewId(this.options.app.workspace.getMostRecentLeaf(this.options.app.workspace.rightSplit));
    if (viewId) this.lastFocusedPanelViewId = viewId;
  }

  private openPanelSnapshotWithFocus(snapshot: ChatWorkspacePanelSnapshot): WorkspacePanelSnapshot {
    return { ...snapshot, lastFocused: snapshot.viewId === this.lastFocusedPanelViewId };
  }

  private scheduleWorkspacePanelReconcileTimer(callback: () => void, delay: number): void {
    const lifecycle = this.ensureWorkspacePanelReconcileScheduled();
    if (!lifecycle) return;
    const timer = window.setTimeout(() => {
      if (this.workspacePanelReconcileSchedule !== lifecycle) return;
      lifecycle.timers.delete(timer);
      callback();
      if (this.workspacePanelReconcileSchedule === lifecycle && lifecycle.timers.size === 0) {
        this.workspacePanelReconcileSchedule = { kind: "idle" };
      }
    }, delay);
    lifecycle.timers.add(timer);
  }

  private async loadRestoredPanelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (this.workspacePanelReconcileSchedule.kind === "cancelled") return;
    try {
      await leaf.loadIfDeferred();
    } catch {
      ignoreWorkspacePanelLoadError();
    }
  }

  private async hydratePanelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (!(leaf.view instanceof CodexChatView)) {
      if (leaf.getViewState().type !== VIEW_TYPE_CODEX_PANEL) return;
      await leaf.loadIfDeferred();
    }
    if (leaf.view instanceof CodexChatView) {
      this.recordLastFocusedPanel(leaf);
      await workspacePanelSurface(leaf.view).hydrateRestoredThread();
    }
  }

  private ensureWorkspacePanelReconcileScheduled(): Extract<WorkspacePanelReconcileScheduleState, { kind: "scheduled" }> | null {
    if (this.workspacePanelReconcileSchedule.kind === "cancelled") return null;
    if (this.workspacePanelReconcileSchedule.kind === "scheduled") return this.workspacePanelReconcileSchedule;
    const lifecycle: Extract<WorkspacePanelReconcileScheduleState, { kind: "scheduled" }> = { kind: "scheduled", timers: new Set() };
    this.workspacePanelReconcileSchedule = lifecycle;
    return lifecycle;
  }
}

function isIdleEmptyPanelSnapshot(snapshot: ChatWorkspacePanelSnapshot): boolean {
  return (
    snapshot.threadId === null &&
    snapshot.turnLifecycle.kind === "idle" &&
    !hasPendingRequests(snapshot.pendingRequests) &&
    !snapshot.hasComposerDraft
  );
}

function focusedPanelViewId(leaf: WorkspaceLeaf | null): string | null {
  return leaf?.view instanceof CodexChatView ? workspacePanelSurface(leaf.view).openPanelSnapshot().viewId : null;
}

function workspacePanelSurface(view: CodexChatView): ChatWorkspacePanelSurface {
  return view.surface;
}

function restoredThreadId(leaf: WorkspaceLeaf): string | null {
  const state = leaf.getViewState().state;
  if (!state || typeof state !== "object") return null;
  const threadId = (state as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}

function restoredPanelSnapshot(leaf: WorkspaceLeaf, index: number): WorkspacePanelSnapshot | null {
  const threadId = restoredThreadId(leaf);
  if (!threadId) return null;
  return {
    viewId: `restored:${String(index)}:${threadId}`,
    threadId,
    turnLifecycle: { kind: "idle" },
    pendingRequests: pendingRequestCounts({ pendingApprovals: 0, pendingUserInputs: 0, pendingMcpElicitations: 0 }),
    hasComposerDraft: false,
    connected: false,
    lastFocused: false,
  };
}
