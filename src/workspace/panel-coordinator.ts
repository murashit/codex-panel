import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CODEX_PANEL } from "../constants";
import type { ChatSharedThreadSurface, ChatWorkspacePanelSnapshot, WorkspacePanels } from "../features/chat/host/contracts";
import { CodexChatView } from "../features/chat/host/view.obsidian";
import { parseChatPanelViewState } from "../features/chat/host/view-state";

type ForkDraftPreparation = Parameters<WorkspacePanels["openForkDraft"]>[0];
type ForkDisplaySnapshot = Parameters<WorkspacePanels["openThreadInNewView"]>[1];

import { DeferredTask } from "../shared/async/deferred-task";
import { createKeyedOperationCoordinator } from "../shared/async/keyed-operation-coordinator";
import { duplicatePanels } from "./panel-ownership";

type WorkspacePanelReconcileMode = "repair" | "foreground" | "restore";

const ignoreWorkspacePanelLoadError = (): void => undefined;

export interface WorkspacePanelSnapshot extends ChatWorkspacePanelSnapshot {
  lastFocused: boolean;
}

export interface WorkspacePanelCoordinatorOptions {
  app: App;
  refreshThreadsViewLiveState: () => void;
}

export class WorkspacePanelCoordinator {
  private readonly workspacePanelReconcile = new DeferredTask(() => window, 0);
  private scheduledReconcile: "repair" | "restore" = "repair";
  private repairingDuplicates = false;
  private pendingRestoredRepairs = new WeakSet<WorkspaceLeaf>();
  private lastFocusedPanelViewId: string | null = null;
  private readonly deferredLeafLoads = new WeakMap<WorkspaceLeaf, Promise<void>>();
  private readonly threadPanelOperations = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
  private duplicatePanelLeaves = new WeakSet<WorkspaceLeaf>();

  constructor(private readonly options: WorkspacePanelCoordinatorOptions) {}

  reset(): void {
    this.cancelWorkspacePanelReconcile();
    this.pendingRestoredRepairs = new WeakSet();
    this.lastFocusedPanelViewId = null;
    this.duplicatePanelLeaves = new WeakSet();
  }

  async activateView(): Promise<CodexChatView | null> {
    const target = this.findCurrentThreadPanelLeaf();
    if (target) return this.activatePanelLeaf(target, true);

    const leaf = await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: false,
      reveal: false,
    });
    if (!isAttachedChatView(leaf.view)) return null;
    const view = leaf.view;
    if (!(await this.revealAndVerifyPanel(leaf, view))) return null;
    const surface = view.surface;
    await surface.connect();
    this.focusOwnedPanel(leaf, view);
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
      await view.surface.startNewThread({ focus: false });
      this.focusOwnedPanel(leaf, view);
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
    const view = await this.createNewViewNow(options.state);
    if (!view) return null;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return null;
    if (!(await this.revealAndVerifyPanel(leaf, view))) return null;
    const surface = view.surface;
    if (options.connect !== false) await surface.connect();
    if (options.focus === false) return view;
    this.focusOwnedPanel(leaf, view);
    return view;
  }

  private async createNewViewNow(state?: Record<string, unknown>): Promise<CodexChatView | null> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: false, ...(state ? { state } : {}) });
    if (!isAttachedChatView(leaf.view)) return null;
    return leaf.view;
  }

  async openThreadInNewView(threadId: string, displaySnapshot?: ForkDisplaySnapshot): Promise<void> {
    await this.runThreadPanelOperation(threadId, () => {
      const target = this.findOpenThreadPanelLeaf(threadId) ?? this.findRestoredThreadPanelLeaf(threadId);
      return this.openThreadAtLeaf(target, threadId, displaySnapshot);
    });
  }

  async openForkDraft(preparation: ForkDraftPreparation, initialMessage?: string): Promise<void> {
    const view = await this.createNewViewNow();
    if (!view) return;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return;
    await this.completePanelOperation(leaf, view, view.surface.applyForkDraft(preparation, initialMessage));
  }

  async openNewPanel(): Promise<void> {
    await this.activateNewView();
  }

  async openThreadInAvailableView(threadId: string): Promise<void> {
    await this.runThreadPanelOperation(threadId, () => this.openThreadAtLeaf(this.findThreadPanelLeaf(threadId), threadId));
  }

  async returnFromForkDraft(threadId: string, originViewId: string, isCurrent: () => boolean): Promise<boolean> {
    return this.runThreadPanelOperation(threadId, async () => {
      const origin = this.findPanelLeafByViewId(originViewId);
      if (!origin || !isCurrent()) return false;
      const target = this.findOpenThreadPanelLeaf(threadId) ?? this.findRestoredThreadPanelLeaf(threadId) ?? origin;
      if (!(await this.openThreadAtLeaf(target, threadId))) return false;
      if (!isAttachedChatView(target.view) || target.view.surface.openPanelSnapshot().threadId !== threadId) return false;
      if (target !== origin) {
        if (!isCurrent() || this.findPanelLeafByViewId(originViewId) !== origin) return false;
        origin.detach();
      }
      return true;
    });
  }

  async openThreadFromPanel(threadId: string, originViewId: string, originSwitchable: boolean): Promise<void> {
    await this.runThreadPanelOperation(threadId, () => {
      const origin = this.findPanelLeafByViewId(originViewId);
      const target =
        this.findOpenThreadPanelLeaf(threadId) ??
        this.findRestoredThreadPanelLeaf(threadId) ??
        (originSwitchable ? origin : null) ??
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

  getOpenPanelSnapshots(): WorkspacePanelSnapshot[] {
    const panels = this.capturePanels(this.panelLeaves());
    const duplicates = duplicatePanels(panels);
    const focusedViewId =
      this.lastFocusedPanelViewId ??
      this.initialFocusedPanelViewId(panels.filter((panel) => !duplicates.has(panel)).map((panel) => panel.leaf));
    return panels.flatMap((panel) => {
      if (duplicates.has(panel) || !panel.snapshot) return [];
      return [{ ...panel.snapshot, lastFocused: panel.attached && panel.snapshot.viewId === focusedViewId }];
    });
  }

  activeLeafChanged(leaf: WorkspaceLeaf | null): void {
    this.reconcileWorkspacePanels(leaf);
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

  reconcileWorkspacePanels(hintLeaf: WorkspaceLeaf | null = null, mode: WorkspacePanelReconcileMode = "foreground"): void {
    const leaves = this.panelLeaves();
    const duplicatePanelLeaves = this.repairDuplicatePanels(leaves);
    const activeLeaves = leaves.filter((leaf) => !duplicatePanelLeaves.has(leaf));
    this.lastFocusedPanelViewId ??= this.initialFocusedPanelViewId(activeLeaves);
    const foregroundLeaf = mode === "repair" ? null : this.foregroundPanelLeaf(activeLeaves, hintLeaf);
    if (foregroundLeaf) {
      void this.hydratePanelLeaf(foregroundLeaf).catch(ignoreWorkspacePanelLoadError);
    }

    if (mode === "restore") {
      for (const leaf of leaves) {
        if (duplicatePanelLeaves.has(leaf)) continue;
        if (leaf === foregroundLeaf) continue;
        void this.loadRestoredPanelLeaf(leaf);
      }
    }
    if (mode !== "foreground") this.options.refreshThreadsViewLiveState();
  }

  scheduleWorkspacePanelReconcile(options: { restore?: boolean } = {}): void {
    if (options.restore !== false) this.scheduledReconcile = "restore";
    this.workspacePanelReconcile.schedule(() => {
      const requested = this.scheduledReconcile;
      this.scheduledReconcile = "repair";
      this.reconcileWorkspacePanels(null, requested);
    });
  }

  cancelWorkspacePanelReconcile(): void {
    this.scheduledReconcile = "repair";
    this.workspacePanelReconcile.clear();
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
    return this.findAttachedPanelLeaf((snapshot) => snapshot.threadId === threadId);
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
    return this.findAttachedPanelLeaf(isIdleEmptyPanelSnapshot);
  }

  private findPanelLeafByViewId(viewId: string): WorkspaceLeaf | null {
    return this.findAttachedPanelLeaf((snapshot) => snapshot.viewId === viewId);
  }

  private findAttachedPanelLeaf(matches: (snapshot: ChatWorkspacePanelSnapshot) => boolean): WorkspaceLeaf | null {
    return this.panelLeaves().find((leaf) => isAttachedChatView(leaf.view) && matches(leaf.view.surface.openPanelSnapshot())) ?? null;
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

  private capturePanels(leaves: readonly WorkspaceLeaf[]) {
    const activeView = this.options.app.workspace.getActiveViewOfType(CodexChatView);
    return leaves.map((leaf, index) => {
      const view = leaf.view;
      const attached = isAttachedChatView(view);
      const snapshot = attached ? view.surface.openPanelSnapshot() : restoredPanelSnapshot(leaf, index);
      return { leaf, view, attached, active: attached && view === activeView, threadId: snapshot?.threadId ?? null, snapshot };
    });
  }

  private repairDuplicatePanels(leaves: readonly WorkspaceLeaf[]): Set<WorkspaceLeaf> {
    const panels = this.capturePanels(leaves);
    const duplicateCandidates = duplicatePanels(panels);
    const duplicates = new Set([...duplicateCandidates].map((panel) => panel.leaf));
    // Host mutations can synchronously emit another layout or activity event.
    if (this.repairingDuplicates) {
      this.scheduleWorkspacePanelReconcile({ restore: false });
      return duplicates;
    }
    this.duplicatePanelLeaves = new WeakSet(duplicates);
    this.repairingDuplicates = true;
    try {
      for (const panel of duplicateCandidates) {
        if (!this.panelLeaves().includes(panel.leaf) || panel.leaf.view !== panel.view) continue;
        if (panel.attached) {
          if (isAttachedChatView(panel.view) && panel.view.surface.openPanelSnapshot().threadId === panel.threadId) {
            panel.leaf.detach();
          }
        } else if (!isAttachedChatView(panel.leaf.view) && restoredThreadId(panel.leaf) === panel.threadId) {
          this.clearDuplicateRestoredPanel(panel.leaf);
        }
      }
    } finally {
      this.repairingDuplicates = false;
    }
    return duplicates;
  }

  private clearDuplicateRestoredPanel(leaf: WorkspaceLeaf): void {
    const pending = this.pendingRestoredRepairs;
    if (pending.has(leaf)) return;
    const viewState = leaf.getViewState();
    const writing = leaf.setViewState({ ...viewState, state: { version: 1 } });
    // Suppress concurrent writes only; a failed write may be retried by a later event.
    pending.add(leaf);
    void writing.then(
      () => {
        pending.delete(leaf);
        if (this.pendingRestoredRepairs === pending) this.options.refreshThreadsViewLiveState();
      },
      () => {
        pending.delete(leaf);
      },
    );
  }

  private async activatePanelLeaf(leaf: WorkspaceLeaf, focus: boolean): Promise<CodexChatView | null> {
    await this.options.app.workspace.revealLeaf(leaf);
    if (!isAttachedChatView(leaf.view)) return this.activateNewView({ focus });
    const view = leaf.view;
    if (!this.panelStillOwnsView(leaf, view)) return null;
    const surface = view.surface;
    await surface.connect();
    await surface.activateThread(undefined, { focus: false });
    if (focus) this.focusOwnedPanel(leaf, view);
    return view;
  }

  private async openThreadAtLeaf(leaf: WorkspaceLeaf | null, threadId: string, displaySnapshot?: ForkDisplaySnapshot): Promise<boolean> {
    if (!leaf) return this.openThreadInNewViewNow(threadId, displaySnapshot);
    const wasDeferred = !isAttachedChatView(leaf.view);
    if (wasDeferred) {
      await this.options.app.workspace.revealLeaf(leaf);
      if (!isAttachedChatView(leaf.view)) return false;
    }
    if (!isAttachedChatView(leaf.view)) return false;
    const view = leaf.view;
    if (!this.panelStillOwnsView(leaf, view)) return false;
    const surface = view.surface;
    const opening = surface.activateThread(threadId, { focus: false, ...(displaySnapshot ? { displaySnapshot } : {}) });
    return this.completePanelOperation(leaf, view, opening, { reveal: !wasDeferred });
  }

  private async openThreadInNewViewNow(threadId: string, displaySnapshot?: ForkDisplaySnapshot): Promise<boolean> {
    const view = await this.createNewViewNow({ version: 1, threadId });
    if (!view) return false;
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    if (!leaf) return false;
    const surface = view.surface;
    const opening = surface.activateThread(threadId, { focus: false, ...(displaySnapshot ? { displaySnapshot } : {}) });
    return this.completePanelOperation(leaf, view, opening);
  }

  private async startNewChatInView(leaf: WorkspaceLeaf, view: CodexChatView): Promise<void> {
    const surface = view.surface;
    const starting = surface.startNewThread({ focus: false });
    await this.completePanelOperation(leaf, view, starting);
  }

  private panelStillOwnsView(leaf: WorkspaceLeaf, view: CodexChatView): boolean {
    return this.panelLeaves().includes(leaf) && leaf.view === view && isAttachedChatView(leaf.view);
  }

  private async revealAndVerifyPanel(leaf: WorkspaceLeaf, view: CodexChatView): Promise<boolean> {
    await this.options.app.workspace.revealLeaf(leaf);
    return this.panelStillOwnsView(leaf, view);
  }

  private focusOwnedPanel(leaf: WorkspaceLeaf, view: CodexChatView): boolean {
    if (!this.panelStillOwnsView(leaf, view)) return false;
    view.surface.focusComposer({ force: true });
    return true;
  }

  private async completePanelOperation(
    leaf: WorkspaceLeaf,
    view: CodexChatView,
    operation: Promise<void> | Promise<boolean>,
    options: { reveal?: boolean } = {},
  ): Promise<boolean> {
    const [completed, ownsPanel] = await Promise.all([
      operation,
      options.reveal === false ? Promise.resolve(true) : this.revealAndVerifyPanel(leaf, view),
    ]);
    return completed !== false && ownsPanel && this.focusOwnedPanel(leaf, view);
  }

  private initialFocusedPanelViewId(leaves: readonly WorkspaceLeaf[]): string | null {
    const activeView = this.options.app.workspace.getActiveViewOfType(CodexChatView);
    const activeLeaf = activeView ? (leaves.find((leaf) => leaf.view === activeView) ?? null) : null;
    const recentLeaf = this.options.app.workspace.getMostRecentLeaf(this.options.app.workspace.rightSplit);
    return focusedPanelViewId(activeLeaf) ?? focusedPanelViewId(recentLeaf && leaves.includes(recentLeaf) ? recentLeaf : null);
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
      await leaf.view.surface.activateThread(undefined, { focus: false });
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
  return snapshot.threadId === null && !snapshot.turnBusy && !snapshot.pending && !snapshot.hasComposerDraft && !snapshot.hasForkDraft;
}

function focusedPanelViewId(leaf: WorkspaceLeaf | null): string | null {
  return isAttachedChatView(leaf?.view) ? leaf.view.surface.openPanelSnapshot().viewId : null;
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
    hasForkDraft: false,
    connected: false,
    lastFocused: false,
  };
}
