import type { App, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../constants";
import type { ChatSharedThreadSurface, ChatWorkspacePanelSnapshot, ChatWorkspacePanelSurface } from "../features/chat/host/contracts";
import { CodexChatView } from "../features/chat/host/view.obsidian";
import { parseChatPanelViewState } from "../features/chat/host/view-state";
import { createKeyedOperationQueue } from "../shared/runtime/keyed-operation-queue";

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
  private readonly deferredLeafLoads = new WeakMap<WorkspaceLeaf, Promise<void>>();
  private readonly threadPanelOperations = createKeyedOperationQueue<string>();
  private duplicatePanelLeaves = new WeakSet<WorkspaceLeaf>();

  constructor(private readonly options: WorkspacePanelCoordinatorOptions) {}

  reset(): void {
    this.cancelWorkspacePanelReconcile();
    this.lastFocusedPanelViewId = null;
    this.duplicatePanelLeaves = new WeakSet();
  }

  async activateView(): Promise<CodexChatView | null> {
    return this.activateViewNow();
  }

  private async activateViewNow(focus = true): Promise<CodexChatView | null> {
    const target = this.findCurrentThreadPanelLeaf();
    if (target) return this.activatePanelLeaf(target, focus);

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
    if (focus) surface.focusComposer({ force: true });
    return view;
  }

  async startNewChat(): Promise<void> {
    const target = this.findCurrentThreadPanelLeaf();
    if (target && isAttachedChatView(target.view)) {
      await this.startNewChatInView(target, target.view);
      return;
    }
    if (target) {
      const view = await this.activatePanelLeaf(target, false);
      if (!view) return;
      const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
      if (!leaf) return;
      await workspacePanelSurface(view).startNewThread({ focus: false });
      if (this.panelStillOwnsView(leaf, view)) workspacePanelSurface(view).focusComposer({ force: true });
      return;
    }

    const view = await this.createNewViewNow();
    if (!view) return;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return;
    await this.startNewChatInView(leaf, view);
  }

  async activateNewView(
    options: { connect?: boolean; focus?: boolean; state?: Record<string, unknown> } = {},
  ): Promise<CodexChatView | null> {
    return this.activateNewViewNow(options);
  }

  private async activateNewViewNow(options: {
    connect?: boolean;
    focus?: boolean;
    state?: Record<string, unknown>;
  }): Promise<CodexChatView | null> {
    const view = await this.createNewViewNow(options.state);
    if (!view) return null;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return null;
    await this.revealForeground(leaf);
    if (!this.panelStillOwnsView(leaf, view)) return null;
    const surface = workspacePanelSurface(view);
    if (options.connect !== false) await surface.connect();
    if (options.focus === false) return view;
    surface.focusComposer({ force: true });
    return view;
  }

  private async createNewViewNow(state?: Record<string, unknown>): Promise<CodexChatView | null> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: false, ...(state ? { state } : {}) });
    if (!isAttachedChatView(leaf.view)) return null;
    return leaf.view;
  }

  async openThreadInNewView(threadId: string): Promise<void> {
    await this.runThreadPanelOperation(threadId, () => {
      const target = this.findOpenThreadPanelLeaf(threadId) ?? this.findRestoredThreadPanelLeaf(threadId);
      return this.openThreadAtLeaf(target, threadId);
    });
  }

  async openSideChat(sourceThreadId: string, sourceThreadTitle: string | null, initialMessage?: string): Promise<void> {
    const view = await this.createNewViewNow({
      version: 2,
      ephemeralSource: { threadId: sourceThreadId, title: sourceThreadTitle },
    });
    if (!view) return;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return;
    const surface = workspacePanelSurface(view);
    const opening = surface.openSideChat(
      { sourceThreadId, sourceThreadTitle, ...(initialMessage ? { initialMessage } : {}) },
      { focus: false },
    );
    const revealing = this.revealForeground(leaf);
    const [opened] = await Promise.all([opening, revealing]);
    if (!opened || !this.panelStillOwnsView(leaf, view)) return;
    surface.focusComposer({ force: true });
  }

  async openNewPanel(): Promise<void> {
    await this.activateNewViewNow({});
  }

  async openThreadInAvailableView(threadId: string): Promise<void> {
    await this.runThreadPanelOperation(threadId, () => this.openThreadAtLeaf(this.findThreadPanelLeaf(threadId), threadId));
  }

  async openThreadFromPanel(threadId: string, originViewId: string, originSwitchable: boolean): Promise<void> {
    await this.runThreadPanelOperation(threadId, () => {
      const target =
        this.findOpenThreadPanelLeaf(threadId) ??
        this.findRestoredThreadPanelLeaf(threadId) ??
        (originSwitchable ? this.findPanelLeafByViewId(originViewId) : null) ??
        this.findIdleEmptyThreadPanelLeaf();
      return this.openThreadAtLeaf(target, threadId);
    });
  }

  async openThreadInCurrentView(threadId: string): Promise<void> {
    await this.runThreadPanelOperation(threadId, () => {
      const target =
        this.findOpenThreadPanelLeaf(threadId) ?? this.findRestoredThreadPanelLeaf(threadId) ?? this.findCurrentThreadPanelLeaf();
      return this.openThreadAtLeaf(target, threadId);
    });
  }

  async focusThreadInOpenView(threadId: string): Promise<boolean> {
    return this.runThreadPanelOperation(threadId, async () => {
      const target = this.findOpenThreadPanelLeaf(threadId) ?? this.findRestoredThreadPanelLeaf(threadId);
      if (!target) return false;
      return this.openThreadAtLeaf(target, threadId);
    });
  }

  getOpenPanelSnapshots(): WorkspacePanelSnapshot[] {
    const leaves = this.panelLeaves();
    const duplicatePanelLeaves = this.repairDuplicatePanels(leaves);
    this.ensureInitialFocusedPanel(leaves);
    return leaves.flatMap((leaf, index) => {
      if (duplicatePanelLeaves.has(leaf)) return [];
      if (isAttachedChatView(leaf.view)) return [this.openPanelSnapshotWithFocus(workspacePanelSurface(leaf.view).openPanelSnapshot())];
      const restoredSnapshot = restoredPanelSnapshot(leaf, index);
      return restoredSnapshot ? [restoredSnapshot] : [];
    });
  }

  activeLeafChanged(leaf: WorkspaceLeaf | null): void {
    this.reconcileWorkspacePanels(leaf);
  }

  async focusOpenPanel(viewId: string, threadId: string | null = null): Promise<boolean> {
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view) || workspacePanelSurface(leaf.view).openPanelSnapshot().viewId !== viewId) continue;
      const view = leaf.view;
      const surface = workspacePanelSurface(view);
      const focusing = surface.focusThread(threadId, { focus: false });
      const revealing = this.revealForeground(leaf);
      await Promise.all([focusing, revealing]);
      if (!this.panelStillOwnsView(leaf, view)) return false;
      surface.focusComposer({ force: true });
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
    const duplicatePanelLeaves = this.repairDuplicatePanels(leaves);
    const activeLeaves = leaves.filter((leaf) => !duplicatePanelLeaves.has(leaf));
    const foregroundLeaf = this.foregroundPanelLeaf(activeLeaves, hintLeaf);
    if (foregroundLeaf) {
      void this.hydratePanelLeaf(foregroundLeaf).catch(ignoreWorkspacePanelLoadError);
    }

    if (options.loadRestoredLeaves) {
      for (const leaf of leaves) {
        if (duplicatePanelLeaves.has(leaf)) continue;
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

  private findThreadPanelLeaf(threadId: string): WorkspaceLeaf | null {
    return this.findOpenThreadPanelLeaf(threadId) ?? this.findRestoredThreadPanelLeaf(threadId) ?? this.findIdleEmptyThreadPanelLeaf();
  }

  private findOpenThreadPanelLeaf(threadId: string): WorkspaceLeaf | null {
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view)) continue;
      if (workspacePanelSurface(leaf.view).openPanelSnapshot().threadId !== threadId) continue;
      return leaf;
    }
    return null;
  }

  private findRestoredThreadPanelLeaf(threadId: string): WorkspaceLeaf | null {
    for (const leaf of this.panelLeaves()) {
      if (isAttachedChatView(leaf.view)) continue;
      if (this.duplicatePanelLeaves.has(leaf)) continue;
      if (restoredThreadId(leaf) !== threadId) continue;
      return leaf;
    }
    return null;
  }

  private findIdleEmptyThreadPanelLeaf(): WorkspaceLeaf | null {
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view)) continue;
      if (!isIdleEmptyPanelSnapshot(workspacePanelSurface(leaf.view).openPanelSnapshot())) continue;
      return leaf;
    }
    return null;
  }

  private findPanelLeafByViewId(viewId: string): WorkspaceLeaf | null {
    for (const leaf of this.panelLeaves()) {
      if (!isAttachedChatView(leaf.view)) continue;
      if (workspacePanelSurface(leaf.view).openPanelSnapshot().viewId !== viewId) continue;
      return leaf;
    }
    return null;
  }

  private findCurrentThreadPanelLeaf(): WorkspaceLeaf | null {
    this.repairDuplicatePanels(this.panelLeaves());
    const { workspace } = this.options.app;
    const active = this.findActiveThreadPanelLeaf();
    if (active) return active;

    const mostRecent = workspace.getMostRecentLeaf(workspace.rightSplit);
    const target = mostRecent ? this.panelLeafFromCandidate(mostRecent) : null;
    if (target) return target;

    for (const leaf of this.panelLeaves()) {
      const fallback = this.panelLeafFromCandidate(leaf);
      if (fallback) return fallback;
    }
    return null;
  }

  private findActiveThreadPanelLeaf(): WorkspaceLeaf | null {
    const activeView = this.options.app.workspace.getActiveViewOfType(CodexChatView);
    if (!activeView) return null;

    for (const leaf of this.panelLeaves()) {
      if (leaf.view === activeView) return this.panelLeafFromCandidate(leaf);
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

  private panelLeafFromCandidate(leaf: WorkspaceLeaf): WorkspaceLeaf | null {
    if (!this.panelLeaves().includes(leaf)) return null;
    if (isAttachedChatView(leaf.view)) return leaf;
    if (this.duplicatePanelLeaves.has(leaf)) return null;
    if (leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL) return leaf;
    return null;
  }

  private runThreadPanelOperation<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    return this.threadPanelOperations.run(threadId, async () => {
      this.repairDuplicatePanels(this.panelLeaves());
      return operation();
    });
  }

  private repairDuplicatePanels(leaves: readonly WorkspaceLeaf[]): Set<WorkspaceLeaf> {
    const ownedThreadIds = new Set<string>();
    const duplicates = new Set<WorkspaceLeaf>();
    const activeView = this.options.app.workspace.getActiveViewOfType(CodexChatView);
    const orderedLeaves = activeView
      ? [...leaves].sort((left, right) => Number(right.view === activeView) - Number(left.view === activeView))
      : leaves;

    for (const leaf of orderedLeaves) {
      if (!isAttachedChatView(leaf.view)) continue;
      const threadId = workspacePanelSurface(leaf.view).openPanelSnapshot().threadId;
      if (!threadId) continue;
      if (ownedThreadIds.has(threadId)) {
        duplicates.add(leaf);
        leaf.detach();
        continue;
      }
      ownedThreadIds.add(threadId);
    }

    for (const leaf of orderedLeaves) {
      if (isAttachedChatView(leaf.view)) continue;
      const threadId = restoredThreadId(leaf);
      if (!threadId) continue;
      if (ownedThreadIds.has(threadId)) {
        duplicates.add(leaf);
        if (!this.duplicatePanelLeaves.has(leaf)) {
          const viewState = leaf.getViewState();
          void leaf.setViewState({ ...viewState, state: { version: 1 } }).catch(ignoreWorkspacePanelLoadError);
        }
        continue;
      }
      ownedThreadIds.add(threadId);
    }
    this.duplicatePanelLeaves = new WeakSet(duplicates);
    return duplicates;
  }

  private async activatePanelLeaf(leaf: WorkspaceLeaf, focus: boolean): Promise<CodexChatView | null> {
    await this.revealForeground(leaf);
    if (!isAttachedChatView(leaf.view)) return this.activateNewViewNow({ focus });
    const view = leaf.view;
    if (!this.panelStillOwnsView(leaf, view)) return null;
    const surface = workspacePanelSurface(view);
    await surface.connect();
    await surface.focusThread(null, { focus: false });
    if (focus && this.panelStillOwnsView(leaf, view)) surface.focusComposer({ force: true });
    return view;
  }

  private async openThreadAtLeaf(leaf: WorkspaceLeaf | null, threadId: string): Promise<boolean> {
    if (!leaf) return this.openThreadInNewViewNow(threadId);
    const wasDeferred = !isAttachedChatView(leaf.view);
    const existingThreadId = wasDeferred ? restoredThreadId(leaf) : null;
    if (wasDeferred) {
      await this.revealForeground(leaf);
      if (!isAttachedChatView(leaf.view)) return false;
    }
    if (!isAttachedChatView(leaf.view)) return false;
    const view = leaf.view;
    if (!this.panelStillOwnsView(leaf, view)) return false;
    const surface = workspacePanelSurface(view);
    const currentThreadId = existingThreadId ?? surface.openPanelSnapshot().threadId;
    const opening =
      currentThreadId === threadId ? surface.focusThread(threadId, { focus: false }) : surface.openThread(threadId, { focus: false });
    await Promise.all([opening, wasDeferred ? Promise.resolve() : this.revealForeground(leaf)]);
    if (!this.panelStillOwnsView(leaf, view)) return false;
    surface.focusComposer({ force: true });
    return true;
  }

  private async openThreadInNewViewNow(threadId: string): Promise<boolean> {
    const view = await this.createNewViewNow({ version: 1, threadId });
    if (!view) return false;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return false;
    const surface = workspacePanelSurface(view);
    const opening = surface.focusThread(threadId, { focus: false });
    const revealing = this.revealForeground(leaf);
    await Promise.all([opening, revealing]);
    if (!this.panelStillOwnsView(leaf, view)) return false;
    surface.focusComposer({ force: true });
    return true;
  }

  private async startNewChatInView(leaf: WorkspaceLeaf, view: CodexChatView): Promise<void> {
    const surface = workspacePanelSurface(view);
    const starting = surface.startNewThread({ focus: false });
    const revealing = this.revealForeground(leaf);
    await Promise.all([starting, revealing]);
    if (!this.panelStillOwnsView(leaf, view)) return;
    surface.focusComposer({ force: true });
  }

  private panelStillOwnsView(leaf: WorkspaceLeaf, view: CodexChatView): boolean {
    return this.panelLeaves().includes(leaf) && leaf.view === view && isAttachedChatView(leaf.view);
  }

  private async revealForeground(leaf: WorkspaceLeaf): Promise<void> {
    await this.options.app.workspace.revealLeaf(leaf);
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
    hasComposerDraft: false,
    connected: false,
    lastFocused: false,
  };
}
