import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CODEX_PANEL } from "../constants";
import type {
  ChatPanelHandle,
  ChatSharedThreadSurface,
  ChatWorkspacePanelSnapshot,
  RuntimePanelOperations,
  WorkspacePanels,
} from "../features/chat/host/contracts";
import { CodexChatView } from "../features/chat/host/view.obsidian";
import { chatPanelViewState, parseChatPanelViewState } from "../features/chat/host/view-state";

type ForkDraftPreparation = Parameters<WorkspacePanels["openForkDraft"]>[0];
type ForkDisplaySnapshot = Parameters<WorkspacePanels["openThreadInNewView"]>[1];

import { DeferredTask } from "../shared/async/deferred-task";
import { createKeyedOperationCoordinator } from "../shared/async/keyed-operation-coordinator";
import { duplicatePanels } from "./panel-ownership";

type OperationCurrent = () => boolean;

interface PanelTarget {
  leaf: WorkspaceLeaf;
  view: CodexChatView;
  surface: ChatPanelHandle;
  isCurrent: OperationCurrent;
}

type WorkspacePanelReconcileMode = "repair" | "foreground" | "restore";

const ignoreWorkspacePanelLoadError = (): void => undefined;

export interface WorkspacePanelSnapshot extends ChatWorkspacePanelSnapshot {
  lastFocused: boolean;
}

export interface WorkspacePanelCoordinatorOptions {
  app: App;
  refreshThreadsViewLiveState: () => void;
  workspaceSignal: () => AbortSignal;
}

export class WorkspacePanelCoordinator {
  private readonly workspacePanelReconcile = new DeferredTask(() => window, 0);
  private scheduledReconcile: "repair" | "restore" = "repair";
  private repairingDuplicates = false;
  private pendingRestoredRepairs = new WeakSet<WorkspaceLeaf>();
  private lastFocusedPanelViewId: string | null = null;
  private readonly deferredLeafLoads = new WeakMap<WorkspaceLeaf, Promise<void>>();
  private readonly threadPanelOperations = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
  private readonly materializingPanels = new WeakMap<WorkspaceLeaf, { isCurrent: OperationCurrent }>();
  private duplicatePanelLeaves = new WeakSet<WorkspaceLeaf>();

  constructor(private readonly options: WorkspacePanelCoordinatorOptions) {}

  forRuntime(signal: AbortSignal): RuntimePanelOperations {
    const workspace = this.options.workspaceSignal();
    const isCurrent = () => !signal.aborted && !workspace.aborted;
    return {
      openThreadInNewView: (id, snapshot) => this.openThread(isCurrent, id, () => this.findExistingThreadPanelLeaf(id), snapshot),
      openThreadInAvailableView: (id) =>
        this.openThread(isCurrent, id, () => this.findExistingThreadPanelLeaf(id) ?? this.findIdleEmptyThreadPanelLeaf()),
      openThreadInCurrentView: (id) =>
        this.openThread(isCurrent, id, () => this.findExistingThreadPanelLeaf(id) ?? this.findCurrentThreadPanelLeaf()),
      openThreadFromPanel: (id, origin, switchable) =>
        this.openThread(
          isCurrent,
          id,
          () =>
            this.findExistingThreadPanelLeaf(id) ??
            (switchable ? this.findPanelLeafByViewId(origin) : null) ??
            this.findIdleEmptyThreadPanelLeaf(),
        ),
      openForkDraft: (preparation, message) => this.openForkDraftScoped(isCurrent, preparation, message),
      returnFromForkDraft: (id, origin, originIsCurrent) =>
        this.returnFromForkDraftScoped(() => isCurrent() && originIsCurrent(), id, origin),
    };
  }

  private workspaceIsCurrent(): OperationCurrent {
    const signal = this.options.workspaceSignal();
    return () => !signal.aborted;
  }

  reset(): void {
    this.cancelWorkspacePanelReconcile();
    this.pendingRestoredRepairs = new WeakSet();
    this.lastFocusedPanelViewId = null;
    this.duplicatePanelLeaves = new WeakSet();
  }

  async activateView(): Promise<CodexChatView | null> {
    const isCurrent = this.workspaceIsCurrent();
    if (!isCurrent()) return null;
    const target = this.findCurrentThreadPanelLeaf();
    if (target) return (await this.activatePanelLeaf(isCurrent, target, true))?.view ?? null;

    const leaf = await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: false,
      reveal: false,
    });
    return (await this.revealAndConnect(this.captureTarget(isCurrent, leaf), true))?.view ?? null;
  }

  async startNewChat(): Promise<void> {
    const isCurrent = this.workspaceIsCurrent();
    if (!isCurrent()) return;
    const start = (target: PanelTarget) => this.completePanelOperation(target, () => target.surface.startNewThread({ focus: false }));
    const leaf = this.findCurrentThreadPanelLeaf();
    if (!leaf) {
      await this.withNewView(isCurrent, start);
      return;
    }
    const target = isAttachedChatView(leaf.view)
      ? this.captureTarget(isCurrent, leaf)
      : await this.activatePanelLeaf(isCurrent, leaf, false);
    if (target) await start(target);
  }

  async activateNewView(options: { focus?: boolean } = {}): Promise<CodexChatView | null> {
    return (await this.activateNewTarget(this.workspaceIsCurrent(), options.focus !== false))?.view ?? null;
  }

  private activateNewTarget(isCurrent: OperationCurrent, focus: boolean): Promise<PanelTarget | null> {
    return this.withNewView(isCurrent, (target) => this.revealAndConnect(target, focus));
  }

  private async revealAndConnect(target: PanelTarget | null, focus: boolean): Promise<PanelTarget | null> {
    if (!target || !(await this.revealAndVerifyPanel(target))) return null;
    await target.surface.connect();
    if (!target.isCurrent()) return null;
    if (focus) target.surface.focusComposer({ force: true });
    return target;
  }

  private async withNewView<T>(isCurrent: OperationCurrent, operation: (target: PanelTarget) => Promise<T>): Promise<T | null> {
    if (!isCurrent()) return null;
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");
    return this.materializePanel(
      isCurrent,
      leaf,
      () => leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: false, state: chatPanelViewState() }),
      operation,
    );
  }

  private async materializePanel<T>(
    isCurrent: OperationCurrent,
    leaf: WorkspaceLeaf,
    load: () => Promise<void>,
    operation: (target: PanelTarget) => Promise<T>,
  ): Promise<T | null> {
    const claim = { isCurrent };
    this.materializingPanels.set(leaf, claim);
    let result: Promise<T>;
    try {
      await load();
      const target = this.captureTarget(isCurrent, leaf);
      if (!target) return null;
      // Dispatch hands loading/fork ownership to the session before releasing materialization.
      result = operation(target);
    } finally {
      if (this.materializingPanels.get(leaf) === claim) this.materializingPanels.delete(leaf);
    }
    return result;
  }

  private async openThread(
    isCurrent: OperationCurrent,
    threadId: string,
    selectLeaf: () => WorkspaceLeaf | null,
    displaySnapshot?: ForkDisplaySnapshot,
  ): Promise<void> {
    await this.runThreadPanelOperation(isCurrent, threadId, () =>
      this.openThreadAtLeaf(isCurrent, selectLeaf(), threadId, displaySnapshot),
    );
  }

  private async openForkDraftScoped(
    isCurrent: OperationCurrent,
    preparation: ForkDraftPreparation,
    initialMessage?: string,
  ): Promise<void> {
    await this.withNewView(isCurrent, (target) =>
      this.completePanelOperation(target, () => target.surface.applyForkDraft(preparation, initialMessage)),
    );
  }

  async openNewPanel(): Promise<void> {
    await this.activateNewView();
  }

  private async returnFromForkDraftScoped(isCurrent: OperationCurrent, threadId: string, originViewId: string): Promise<boolean> {
    return this.runThreadPanelOperation(isCurrent, threadId, async () => {
      const origin = this.findPanelLeafByViewId(originViewId);
      if (!origin || !isCurrent()) return false;
      const target = this.findExistingThreadPanelLeaf(threadId) ?? origin;
      if (!(await this.openThreadAtLeaf(isCurrent, target, threadId))) return false;
      if (!isCurrent() || !isAttachedChatView(target.view) || target.view.surface.openPanelSnapshot().threadId !== threadId) return false;
      if (target !== origin) {
        if (!isCurrent() || this.findPanelLeafByViewId(originViewId) !== origin) return false;
        origin.detach();
      }
      return true;
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
      void leaf.setViewState({ ...viewState, state: chatPanelViewState() }).catch(ignoreWorkspacePanelLoadError);
    }
  }

  reconcileWorkspacePanels(hintLeaf: WorkspaceLeaf | null = null, mode: WorkspacePanelReconcileMode = "foreground"): void {
    if (this.options.workspaceSignal().aborted) return;
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

    // Obsidian declares WorkspaceSplit here, but inserts into the supplied leaf parent.
    const sidebar: { createLeafInParent(parent: WorkspaceLeaf["parent"], index: number): WorkspaceLeaf } = workspace;
    return sidebar.createLeafInParent(existing.parent, Number.MAX_SAFE_INTEGER);
  }

  private findExistingThreadPanelLeaf(threadId: string): WorkspaceLeaf | null {
    return this.findAttachedPanelLeaf((snapshot) => snapshot.threadId === threadId) ?? this.findRestoredThreadPanelLeaf(threadId);
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
    return this.findAttachedPanelLeaf(
      (snapshot, leaf) => !this.materializingPanels.get(leaf)?.isCurrent() && isIdleEmptyPanelSnapshot(snapshot),
    );
  }

  private findPanelLeafByViewId(viewId: string): WorkspaceLeaf | null {
    return this.findAttachedPanelLeaf((snapshot) => snapshot.viewId === viewId);
  }

  private findAttachedPanelLeaf(matches: (snapshot: ChatWorkspacePanelSnapshot, leaf: WorkspaceLeaf) => boolean): WorkspaceLeaf | null {
    return this.panelLeaves().find((leaf) => isAttachedChatView(leaf.view) && matches(leaf.view.surface.openPanelSnapshot(), leaf)) ?? null;
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

  private runThreadPanelOperation(isCurrent: OperationCurrent, threadId: string, operation: () => Promise<boolean>): Promise<boolean> {
    return this.threadPanelOperations.run(threadId, async () => {
      if (!isCurrent()) return false;
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
    const writing = leaf.setViewState({ ...viewState, state: chatPanelViewState() });
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

  private async activatePanelLeaf(isCurrent: OperationCurrent, leaf: WorkspaceLeaf, focus: boolean): Promise<PanelTarget | null> {
    if (!isCurrent()) return null;
    await this.options.app.workspace.revealLeaf(leaf);
    if (!isCurrent()) return null;
    if (!isAttachedChatView(leaf.view)) return this.activateNewTarget(isCurrent, focus);
    const target = this.captureTarget(isCurrent, leaf);
    if (!target) return null;
    await target.surface.connect();
    if (!target.isCurrent()) return null;
    await target.surface.activateThread(undefined, { focus: false });
    if (focus) this.focusOwnedPanel(target);
    return target.isCurrent() ? target : null;
  }

  private async openThreadAtLeaf(
    isCurrent: OperationCurrent,
    leaf: WorkspaceLeaf | null,
    threadId: string,
    displaySnapshot?: ForkDisplaySnapshot,
  ): Promise<boolean> {
    if (!isCurrent()) return false;
    const activate = (target: PanelTarget, reveal = true) =>
      this.completePanelOperation(
        target,
        () => target.surface.activateThread(threadId, { focus: false, ...(displaySnapshot ? { displaySnapshot } : {}) }),
        { reveal },
      );
    if (!leaf) return (await this.withNewView(isCurrent, activate)) ?? false;
    if (!isAttachedChatView(leaf.view)) {
      return (
        (await this.materializePanel(
          isCurrent,
          leaf,
          () => this.options.app.workspace.revealLeaf(leaf),
          (target) => activate(target, false),
        )) ?? false
      );
    }
    const target = this.captureTarget(isCurrent, leaf);
    return target ? activate(target) : false;
  }

  private captureTarget(isCurrent: OperationCurrent, leaf: WorkspaceLeaf): PanelTarget | null {
    const view = leaf.view;
    if (!isCurrent() || !isAttachedChatView(view) || !this.panelLeaves().includes(leaf)) return null;
    const surface = view.surface;
    return {
      leaf,
      view,
      surface,
      isCurrent: () =>
        isCurrent() && leaf.view === view && view.isRuntimeAttached() && view.surface === surface && this.panelLeaves().includes(leaf),
    };
  }

  private async revealAndVerifyPanel(target: PanelTarget): Promise<boolean> {
    if (!target.isCurrent()) return false;
    await this.options.app.workspace.revealLeaf(target.leaf);
    return target.isCurrent();
  }

  private focusOwnedPanel(target: PanelTarget): boolean {
    if (!target.isCurrent()) return false;
    target.surface.focusComposer({ force: true });
    return true;
  }

  private async completePanelOperation(
    target: PanelTarget,
    operation: () => Promise<void> | Promise<boolean>,
    options: { reveal?: boolean } = {},
  ): Promise<boolean> {
    if (!target.isCurrent()) return false;
    const [completed, ownsPanel] = await Promise.all([
      operation(),
      options.reveal === false ? Promise.resolve(true) : this.revealAndVerifyPanel(target),
    ]);
    return completed !== false && ownsPanel && this.focusOwnedPanel(target);
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
    const isCurrent = this.workspaceIsCurrent();
    if (!isAttachedChatView(leaf.view)) {
      if (leaf.getViewState().type !== VIEW_TYPE_CODEX_PANEL) return;
      await this.loadDeferredPanelLeaf(leaf);
    }
    if (isCurrent() && isAttachedChatView(leaf.view)) {
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
  return (
    !snapshot.loadingThread &&
    snapshot.threadId === null &&
    !snapshot.turnBusy &&
    !snapshot.pending &&
    !snapshot.hasComposerDraft &&
    !snapshot.hasForkDraft
  );
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
    loadingThread: false,
    threadId,
    turnBusy: false,
    pending: false,
    unread: false,
    hasComposerDraft: false,
    hasForkDraft: false,
    connected: false,
    lastFocused: false,
  };
}
