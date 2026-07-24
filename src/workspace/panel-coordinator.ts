import type { App, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../constants";
import type { ChatSharedThreadSurface, ChatWorkspacePanelSnapshot, ChatWorkspacePanelSurface } from "../features/chat/host/contracts";
import { CodexChatView } from "../features/chat/host/view.obsidian";
import { parseChatPanelViewState } from "../features/chat/host/view-state";

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
  private workspacePanelReconcileTimer: number | null = null;
  private lastFocusedPanelViewId: string | null = null;
  private foregroundIntent: object | null = null;
  private readonly revealingLeafCounts = new Map<WorkspaceLeaf, number>();
  private readonly deferredLeafLoads = new WeakMap<WorkspaceLeaf, Promise<void>>();

  constructor(private readonly options: WorkspacePanelCoordinatorOptions) {}

  reset(): void {
    this.cancelWorkspacePanelReconcile();
    this.lastFocusedPanelViewId = null;
    this.foregroundIntent = null;
    this.revealingLeafCounts.clear();
  }

  async activateView(): Promise<CodexChatView | null> {
    return this.activateViewNow(this.beginForegroundIntent());
  }

  private async activateViewNow(intent: object, focus = true): Promise<CodexChatView | null> {
    const target = this.findCurrentThreadPanelTarget();
    if (target) return this.activateThreadPanelTarget(target, intent, focus);

    const leaf = await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: false,
      reveal: false,
    });
    if (!isAttachedChatView(leaf.view)) return null;
    const view = leaf.view;
    await this.revealForeground(leaf);
    if (!this.panelStillOwnsView(leaf, view)) return null;
    const surface = workspacePanelSurface(view);
    await surface.connect();
    if (focus) {
      this.publishForeground(intent, leaf, view, () => {
        surface.focusComposer({ force: true });
      });
    }
    return view;
  }

  async startNewChat(): Promise<void> {
    const intent = this.beginForegroundIntent();
    const view = await this.activateViewNow(intent, false);
    if (!view) return;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return;
    await workspacePanelSurface(view).startNewThread({ focus: false });
    this.publishForeground(intent, leaf, view, () => {
      workspacePanelSurface(view).focusComposer({ force: true });
    });
  }

  async activateNewView(
    options: { connect?: boolean; focus?: boolean; state?: Record<string, unknown> } = {},
  ): Promise<CodexChatView | null> {
    return this.activateNewViewNow(options, this.beginForegroundIntent());
  }

  private async activateNewViewNow(
    options: { connect?: boolean; focus?: boolean; state?: Record<string, unknown> },
    intent: object,
  ): Promise<CodexChatView | null> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: false, ...(options.state ? { state: options.state } : {}) });
    if (!isAttachedChatView(leaf.view)) return null;
    const view = leaf.view;
    await this.revealForeground(leaf);
    if (!this.panelStillOwnsView(leaf, view)) return null;
    const surface = workspacePanelSurface(view);
    if (options.connect !== false) await surface.connect();
    if (options.focus === false) return view;
    this.publishForeground(intent, leaf, view, () => {
      surface.focusComposer({ force: true });
    });
    return view;
  }

  async openThreadInNewView(threadId: string): Promise<void> {
    await this.openThreadInTarget({ kind: "new" }, threadId, this.beginForegroundIntent());
  }

  async openSideChat(sourceThreadId: string, sourceThreadTitle: string | null): Promise<void> {
    const intent = this.beginForegroundIntent();
    const view = await this.activateNewViewNow(
      {
        connect: false,
        focus: false,
        state: { version: 2, ephemeralSource: { threadId: sourceThreadId, title: sourceThreadTitle } },
      },
      intent,
    );
    if (!view) return;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return;
    const opened = await workspacePanelSurface(view).openSideChat({ sourceThreadId, sourceThreadTitle }, { focus: false });
    if (!opened) return;
    this.publishForeground(intent, leaf, view, () => {
      workspacePanelSurface(view).focusComposer({ force: true });
    });
  }

  async openNewPanel(): Promise<void> {
    await this.activateNewViewNow({}, this.beginForegroundIntent());
  }

  async openThreadInAvailableView(threadId: string): Promise<void> {
    const target = this.findThreadPanelTarget(threadId);
    await this.openThreadInTarget(target, threadId, this.beginForegroundIntent());
  }

  async openThreadFromPanel(threadId: string, originViewId: string, originSwitchable: boolean): Promise<void> {
    const target = this.findOpenThreadPanelTarget(threadId) ??
      this.findRestoredThreadPanelTarget(threadId) ??
      (originSwitchable ? this.findPanelTargetByViewId(originViewId) : null) ??
      this.findIdleEmptyThreadPanelTarget() ?? { kind: "new" };
    await this.openThreadInTarget(target, threadId, this.beginForegroundIntent());
  }

  async openThreadInCurrentView(threadId: string): Promise<void> {
    const target =
      this.findOpenThreadPanelTarget(threadId) ?? this.findRestoredThreadPanelTarget(threadId) ?? this.findCurrentThreadPanelTarget();
    await this.openThreadInTarget(target ?? { kind: "new" }, threadId, this.beginForegroundIntent());
  }

  async focusThreadInOpenView(threadId: string): Promise<boolean> {
    const target = this.findOpenThreadPanelTarget(threadId) ?? this.findRestoredThreadPanelTarget(threadId);
    if (!target) return false;
    return this.openThreadInTarget(target, threadId, this.beginForegroundIntent());
  }

  getOpenPanelSnapshots(): WorkspacePanelSnapshot[] {
    const leaves = this.panelLeaves();
    this.ensureInitialFocusedPanel(leaves);
    return leaves.flatMap((leaf, index) => {
      if (isAttachedChatView(leaf.view)) return [this.openPanelSnapshotWithFocus(workspacePanelSurface(leaf.view).openPanelSnapshot())];
      const restoredSnapshot = restoredPanelSnapshot(leaf, index);
      return restoredSnapshot ? [restoredSnapshot] : [];
    });
  }

  activeLeafChanged(leaf: WorkspaceLeaf | null): void {
    const programmatic = Boolean(leaf && this.revealingLeafCounts.has(leaf));
    if (!programmatic) this.foregroundIntent = null;
    this.reconcileWorkspacePanels(leaf);
  }

  async focusOpenPanel(viewId: string, threadId: string | null = null): Promise<boolean> {
    const intent = this.beginForegroundIntent();
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view) || workspacePanelSurface(leaf.view).openPanelSnapshot().viewId !== viewId) continue;
      const view = leaf.view;
      await this.revealForeground(leaf);
      if (!this.panelStillOwnsView(leaf, view)) return false;
      await workspacePanelSurface(view).focusThread(threadId, { focus: false });
      this.publishForeground(intent, leaf, view, () => {
        workspacePanelSurface(view).focusComposer({ force: true });
      });
      return true;
    }
    return false;
  }

  panelViews(): CodexChatView[] {
    return this.panelLeaves().flatMap((leaf) => (isAttachedChatView(leaf.view) ? [leaf.view] : []));
  }

  applyThreadUnavailable(threadId: string): void {
    for (const leaf of this.panelLeaves()) {
      if (isAttachedChatView(leaf.view)) {
        const surface: ChatSharedThreadSurface = leaf.view.surface;
        surface.applyThreadUnavailable(threadId);
        continue;
      }
      if (restoredThreadId(leaf) !== threadId) continue;
      const viewState = leaf.getViewState();
      void leaf.setViewState({ ...viewState, state: { version: 1 } }).catch(ignoreWorkspacePanelLoadError);
    }
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
    if (this.workspacePanelReconcileTimer !== null) return;
    this.workspacePanelReconcileTimer = window.setTimeout(() => {
      this.workspacePanelReconcileTimer = null;
      this.reconcileWorkspacePanels(null, { loadRestoredLeaves: true });
    }, 0);
  }

  cancelWorkspacePanelReconcile(): void {
    if (this.workspacePanelReconcileTimer === null) return;
    window.clearTimeout(this.workspacePanelReconcileTimer);
    this.workspacePanelReconcileTimer = null;
  }

  private recordLastFocusedPanel(leaf: WorkspaceLeaf | null): void {
    const viewId = focusedPanelViewId(leaf);
    if (!viewId) return;
    if (this.lastFocusedPanelViewId === viewId) return;
    this.lastFocusedPanelViewId = viewId;
    this.options.refreshThreadsViewLiveState();
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

  private findThreadPanelTarget(threadId: string): ThreadPanelTarget {
    return (
      this.findOpenThreadPanelTarget(threadId) ??
      this.findRestoredThreadPanelTarget(threadId) ??
      this.findIdleEmptyThreadPanelTarget() ?? { kind: "new" }
    );
  }

  private findOpenThreadPanelTarget(threadId: string): ThreadPanelTarget | null {
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view)) continue;
      if (workspacePanelSurface(leaf.view).openPanelSnapshot().threadId !== threadId) continue;
      return { kind: "open", leaf, view: leaf.view };
    }
    return null;
  }

  private findRestoredThreadPanelTarget(threadId: string): ThreadPanelTarget | null {
    for (const leaf of this.panelLeaves()) {
      if (isAttachedChatView(leaf.view)) continue;
      if (restoredThreadId(leaf) !== threadId) continue;
      return { kind: "restored", leaf };
    }
    return null;
  }

  private findIdleEmptyThreadPanelTarget(): ThreadPanelTarget | null {
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view)) continue;
      if (!isIdleEmptyPanelSnapshot(workspacePanelSurface(leaf.view).openPanelSnapshot())) continue;
      return { kind: "empty", leaf, view: leaf.view };
    }
    return null;
  }

  private findPanelTargetByViewId(viewId: string): ThreadPanelTarget | null {
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view)) continue;
      if (workspacePanelSurface(leaf.view).openPanelSnapshot().viewId !== viewId) continue;
      return { kind: "reuse", leaf, view: leaf.view };
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
    if (isAttachedChatView(leaf.view)) return leaf;
    return leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL ? leaf : null;
  }

  private threadPanelTargetFromLeaf(leaf: WorkspaceLeaf): ThreadPanelTarget | null {
    if (isAttachedChatView(leaf.view)) return { kind: "reuse", leaf, view: leaf.view };
    if (leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL) return { kind: "restored-reuse", leaf };
    return null;
  }

  private async activateThreadPanelTarget(target: ThreadPanelTarget, intent: object, focus: boolean): Promise<CodexChatView | null> {
    if (target.kind === "new") return this.activateNewViewNow({ focus }, intent);

    await this.revealForeground(target.leaf);
    if ("view" in target) {
      if (!this.panelStillOwnsView(target.leaf, target.view)) return null;
      const surface = workspacePanelSurface(target.view);
      await surface.connect();
      await surface.focusThread(null, { focus: false });
      if (focus) {
        this.publishForeground(intent, target.leaf, target.view, () => {
          surface.focusComposer({ force: true });
        });
      }
      return target.view;
    }

    if (isAttachedChatView(target.leaf.view)) {
      const view = target.leaf.view;
      const surface = workspacePanelSurface(view);
      await surface.connect();
      await surface.focusThread(null, { focus: false });
      if (focus) {
        this.publishForeground(intent, target.leaf, view, () => {
          surface.focusComposer({ force: true });
        });
      }
      return view;
    }

    return this.activateNewViewNow({ focus }, intent);
  }

  private async openThreadInTarget(target: ThreadPanelTarget, threadId: string, intent: object): Promise<boolean> {
    switch (target.kind) {
      case "open":
        await this.revealForeground(target.leaf);
        if (!this.panelStillOwnsView(target.leaf, target.view)) return false;
        await workspacePanelSurface(target.view).focusThread(threadId, { focus: false });
        this.publishForeground(intent, target.leaf, target.view, () => {
          workspacePanelSurface(target.view).focusComposer({ force: true });
        });
        return true;
      case "restored":
        await this.revealForeground(target.leaf);
        if (isAttachedChatView(target.leaf.view)) {
          const view = target.leaf.view;
          await workspacePanelSurface(view).focusThread(threadId, { focus: false });
          this.publishForeground(intent, target.leaf, view, () => {
            workspacePanelSurface(view).focusComposer({ force: true });
          });
          return true;
        } else {
          return this.openThreadInNewViewNow(threadId, intent);
        }
      case "restored-reuse":
        await this.revealForeground(target.leaf);
        if (isAttachedChatView(target.leaf.view)) {
          const view = target.leaf.view;
          await workspacePanelSurface(view).openThread(threadId, { focus: false });
          this.publishForeground(intent, target.leaf, view, () => {
            workspacePanelSurface(view).focusComposer({ force: true });
          });
          return true;
        } else {
          return this.openThreadInNewViewNow(threadId, intent);
        }
      case "empty":
      case "reuse":
        await this.revealForeground(target.leaf);
        if (!this.panelStillOwnsView(target.leaf, target.view)) return false;
        await workspacePanelSurface(target.view).openThread(threadId, { focus: false });
        this.publishForeground(intent, target.leaf, target.view, () => {
          workspacePanelSurface(target.view).focusComposer({ force: true });
        });
        return true;
      case "new":
        return this.openThreadInNewViewNow(threadId, intent);
    }
  }

  private async openThreadInNewViewNow(threadId: string, intent: object): Promise<boolean> {
    const view = await this.activateNewViewNow({ connect: false, focus: false }, intent);
    if (!view) return false;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return false;
    await workspacePanelSurface(view).openThread(threadId, { focus: false });
    this.publishForeground(intent, leaf, view, () => {
      workspacePanelSurface(view).focusComposer({ force: true });
    });
    return true;
  }

  private beginForegroundIntent(): object {
    const intent = {};
    this.foregroundIntent = intent;
    return intent;
  }

  private panelStillOwnsView(leaf: WorkspaceLeaf, view: CodexChatView): boolean {
    return this.panelLeaves().includes(leaf) && leaf.view === view && isAttachedChatView(leaf.view);
  }

  private async revealForeground(leaf: WorkspaceLeaf): Promise<void> {
    this.revealingLeafCounts.set(leaf, (this.revealingLeafCounts.get(leaf) ?? 0) + 1);
    try {
      await this.options.app.workspace.revealLeaf(leaf);
    } finally {
      const remaining = (this.revealingLeafCounts.get(leaf) ?? 1) - 1;
      if (remaining === 0) this.revealingLeafCounts.delete(leaf);
      else this.revealingLeafCounts.set(leaf, remaining);
    }
  }

  private publishForeground(intent: object, leaf: WorkspaceLeaf, view: CodexChatView, publish: () => void): void {
    if (this.foregroundIntent !== intent || !this.panelStillOwnsView(leaf, view)) return;
    publish();
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

  private async loadRestoredPanelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    try {
      await this.loadDeferredPanelLeaf(leaf);
    } catch {
      ignoreWorkspacePanelLoadError();
    }
  }

  private async hydratePanelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (!isAttachedChatView(leaf.view)) {
      if (leaf.getViewState().type !== VIEW_TYPE_CODEX_PANEL) return;
      await this.loadDeferredPanelLeaf(leaf);
    }
    if (isAttachedChatView(leaf.view)) {
      this.recordLastFocusedPanel(leaf);
      await workspacePanelSurface(leaf.view).hydrateRestoredThread();
    }
  }

  private loadDeferredPanelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const existing = this.deferredLeafLoads.get(leaf);
    if (existing) return existing;
    const loading = leaf.loadIfDeferred();
    this.deferredLeafLoads.set(leaf, loading);
    const forget = () => {
      if (this.deferredLeafLoads.get(leaf) === loading) this.deferredLeafLoads.delete(leaf);
    };
    void loading.then(forget, forget);
    return loading;
  }
}

function isIdleEmptyPanelSnapshot(snapshot: ChatWorkspacePanelSnapshot): boolean {
  return snapshot.threadId === null && !snapshot.turnBusy && !snapshot.pending && !snapshot.hasComposerDraft;
}

function focusedPanelViewId(leaf: WorkspaceLeaf | null): string | null {
  return isAttachedChatView(leaf?.view) ? workspacePanelSurface(leaf.view).openPanelSnapshot().viewId : null;
}

function workspacePanelSurface(view: CodexChatView): ChatWorkspacePanelSurface {
  return view.surface;
}

function isAttachedChatView(view: unknown): view is CodexChatView {
  return view instanceof CodexChatView && view.isRuntimeAttached();
}

function restoredThreadId(leaf: WorkspaceLeaf): string | null {
  const state = parseChatPanelViewState(leaf.getViewState().state);
  return state.kind === "thread" ? state.threadId : null;
}

function restoredPanelSnapshot(leaf: WorkspaceLeaf, index: number): WorkspacePanelSnapshot | null {
  const threadId = restoredThreadId(leaf);
  if (!threadId) return null;
  return {
    viewId: `restored:${String(index)}:${threadId}`,
    threadId,
    turnBusy: false,
    pending: false,
    publishedActivity: { threadId, turnBusy: false, pending: false },
    hasComposerDraft: false,
    connected: false,
    lastFocused: false,
  };
}
