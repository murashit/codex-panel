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

type WorkspacePanelReconcileScheduleState = { kind: "idle" } | { kind: "scheduled"; timers: Set<number> } | { kind: "cancelled" };

interface WorkspacePanelTargetLease {
  readonly revision: number;
  readonly leaf: WorkspaceLeaf | null;
  readonly expectedView: CodexChatView | null;
  readonly expectedRestoredThreadId: string | null;
}

interface WorkspaceMaterializedPanelTargetLease extends WorkspacePanelTargetLease {
  readonly leaf: WorkspaceLeaf;
  readonly expectedView: CodexChatView;
}

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
  private foregroundIntentRevision = 0;
  private invokingForegroundRevealLeaf: WorkspaceLeaf | null = null;
  private readonly deferredLeafLoads = new WeakMap<WorkspaceLeaf, Promise<void>>();

  constructor(private readonly options: WorkspacePanelCoordinatorOptions) {}

  reset(): void {
    this.clearWorkspacePanelReconcileTimers();
    this.workspacePanelReconcileSchedule = { kind: "idle" };
    this.lastFocusedPanelViewId = null;
    this.foregroundIntentRevision += 1;
    this.invokingForegroundRevealLeaf = null;
  }

  invalidateRuntimeIntents(): void {
    this.foregroundIntentRevision += 1;
  }

  async activateView(): Promise<CodexChatView | null> {
    return this.runForegroundIntent((revision) => this.activateViewNow(revision));
  }

  private async activateViewNow(revision: number): Promise<CodexChatView | null> {
    const target = this.findCurrentThreadPanelTarget();
    if (target) {
      return this.activateThreadPanelTarget(target, this.capturePanelTargetLease(target, revision));
    }

    const targetLease = this.capturePanelTargetLease({ kind: "new" }, revision);
    const leaf = await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: false,
      reveal: false,
    });
    if (!this.panelTargetLeaseIsCurrent(targetLease)) {
      return null;
    }
    if (!isAttachedChatView(leaf.view)) return null;
    const view = leaf.view;
    const materializedLease = this.captureMaterializedTargetLease(targetLease, leaf, view);
    if (!(await this.revealForeground(materializedLease, leaf))) return null;
    const surface = workspacePanelSurface(view);
    await surface.connect();
    if (!this.panelTargetLeaseIsCurrent(materializedLease)) return null;
    return this.publishForeground(materializedLease, () => {
      surface.focusComposer({ force: true });
    })
      ? view
      : null;
  }

  async startNewChat(): Promise<void> {
    await this.runForegroundIntent(async (revision) => {
      const view = await this.activateViewNow(revision);
      if (!view) return;
      const targetLease = this.captureViewTargetLease(view, revision);
      if (!targetLease) return;
      await workspacePanelSurface(view).startNewThread({ focus: false });
      if (!this.panelTargetLeaseIsCurrent(targetLease)) return;
      this.publishForeground(targetLease, () => {
        workspacePanelSurface(view).focusComposer({ force: true });
      });
    });
  }

  async activateNewView(
    options: { connect?: boolean; focus?: boolean; state?: Record<string, unknown> } = {},
  ): Promise<CodexChatView | null> {
    return this.runForegroundIntent((revision) =>
      this.activateNewViewNow(options, this.capturePanelTargetLease({ kind: "new" }, revision)),
    );
  }

  private async activateNewViewNow(
    options: { connect?: boolean; focus?: boolean; state?: Record<string, unknown> },
    targetLease: WorkspacePanelTargetLease,
  ): Promise<CodexChatView | null> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: false, ...(options.state ? { state: options.state } : {}) });
    if (!this.panelTargetLeaseIsCurrent(targetLease)) {
      leaf.detach();
      return null;
    }
    if (!isAttachedChatView(leaf.view)) return null;
    const view = leaf.view;
    const materializedLease = this.captureMaterializedTargetLease(targetLease, leaf, view);
    if (!(await this.revealForeground(materializedLease, leaf))) return null;
    const surface = workspacePanelSurface(view);
    if (options.connect !== false) await surface.connect();
    if (!this.panelTargetLeaseIsCurrent(materializedLease)) return null;
    if (options.focus === false) return view;
    return this.publishForeground(materializedLease, () => {
      surface.focusComposer({ force: true });
    })
      ? view
      : null;
  }

  async openThreadInNewView(threadId: string): Promise<void> {
    await this.runForegroundIntent(async (revision) => {
      const target = { kind: "new" } as const;
      await this.openThreadInTarget(target, threadId, this.capturePanelTargetLease(target, revision));
    });
  }

  async openSideChat(sourceThreadId: string, sourceThreadTitle: string | null): Promise<void> {
    await this.runForegroundIntent(async (revision) => {
      const targetLease = this.capturePanelTargetLease({ kind: "new" }, revision);
      const view = await this.activateNewViewNow(
        {
          connect: false,
          focus: false,
          state: { version: 2, ephemeralSource: { threadId: sourceThreadId, title: sourceThreadTitle } },
        },
        targetLease,
      );
      if (!view) return;
      const materializedLease = this.captureViewTargetLease(view, revision);
      if (!materializedLease) return;
      const opened = await workspacePanelSurface(view).openSideChat({ sourceThreadId, sourceThreadTitle }, { focus: false });
      if (!opened) return;
      if (!this.panelTargetLeaseIsCurrent(materializedLease)) return;
      this.publishForeground(materializedLease, () => {
        workspacePanelSurface(view).focusComposer({ force: true });
      });
    });
  }

  async openNewPanel(): Promise<void> {
    await this.runForegroundIntent(async (revision) => {
      await this.activateNewViewNow({}, this.capturePanelTargetLease({ kind: "new" }, revision));
    });
  }

  async openThreadInAvailableView(threadId: string): Promise<void> {
    await this.runForegroundIntent(async (revision) => {
      const target = this.findThreadPanelTarget(threadId);
      await this.openThreadInTarget(target, threadId, this.capturePanelTargetLease(target, revision));
    });
  }

  async openThreadFromPanel(threadId: string, originViewId: string, originSwitchable: boolean): Promise<void> {
    await this.runForegroundIntent(async (revision) => {
      const target = this.findOpenThreadPanelTarget(threadId) ??
        this.findRestoredThreadPanelTarget(threadId) ??
        (originSwitchable ? this.findPanelTargetByViewId(originViewId) : null) ??
        this.findIdleEmptyThreadPanelTarget() ?? { kind: "new" };
      await this.openThreadInTarget(target, threadId, this.capturePanelTargetLease(target, revision));
    });
  }

  async openThreadInCurrentView(threadId: string): Promise<void> {
    await this.runForegroundIntent(async (revision) => {
      const target =
        this.findOpenThreadPanelTarget(threadId) ?? this.findRestoredThreadPanelTarget(threadId) ?? this.findCurrentThreadPanelTarget();
      const resolvedTarget = target ?? { kind: "new" };
      await this.openThreadInTarget(resolvedTarget, threadId, this.capturePanelTargetLease(resolvedTarget, revision));
    });
  }

  async focusThreadInOpenView(threadId: string): Promise<boolean> {
    return this.runForegroundIntent(async (revision) => {
      const target = this.findOpenThreadPanelTarget(threadId) ?? this.findRestoredThreadPanelTarget(threadId);
      if (!target) return false;
      return this.openThreadInTarget(target, threadId, this.capturePanelTargetLease(target, revision));
    });
  }

  async openThreadInIdleEmptyView(threadId: string): Promise<boolean> {
    return this.runForegroundIntent(async (revision) => {
      const target = this.findIdleEmptyThreadPanelTarget();
      if (!target) return false;
      return this.openThreadInTarget(target, threadId, this.capturePanelTargetLease(target, revision));
    });
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
    const programmatic = Boolean(leaf && this.invokingForegroundRevealLeaf === leaf);
    if (!programmatic) {
      this.foregroundIntentRevision += 1;
    }
    this.reconcileWorkspacePanels(leaf);
  }

  async focusOpenPanel(viewId: string, threadId: string | null = null): Promise<boolean> {
    return this.runForegroundIntent(async (revision) => {
      for (const leaf of this.panelLeaves()) {
        if (isAttachedChatView(leaf.view) && workspacePanelSurface(leaf.view).openPanelSnapshot().viewId === viewId) {
          const view = leaf.view;
          const targetLease = this.capturePanelTargetLease({ kind: "reuse", leaf, view }, revision);
          if (!(await this.revealForeground(targetLease, leaf))) return false;
          await workspacePanelSurface(view).focusThread(threadId, { focus: false });
          if (!this.panelTargetLeaseIsCurrent(targetLease)) return false;
          return this.publishForeground(targetLease, () => {
            workspacePanelSurface(view).focusComposer({ force: true });
          });
        }
      }
      return false;
    });
  }

  panelViews(): CodexChatView[] {
    return this.panelLeaves().flatMap((leaf) => (isAttachedChatView(leaf.view) ? [leaf.view] : []));
  }

  applyThreadArchived(threadId: string): void {
    for (const leaf of this.panelLeaves()) {
      if (isAttachedChatView(leaf.view)) {
        const surface: ChatSharedThreadSurface = leaf.view.surface;
        surface.applyThreadArchived(threadId);
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

  private async activateThreadPanelTarget(
    target: ThreadPanelTarget,
    targetLease: WorkspacePanelTargetLease,
  ): Promise<CodexChatView | null> {
    if (target.kind === "new") return this.activateNewViewNow({}, targetLease);

    if (!(await this.revealForeground(targetLease, target.leaf))) return null;
    if ("view" in target) {
      const surface = workspacePanelSurface(target.view);
      await surface.connect();
      if (!this.panelTargetLeaseIsCurrent(targetLease)) return null;
      await surface.focusThread(null, { focus: false });
      if (!this.panelTargetLeaseIsCurrent(targetLease)) return null;
      return this.publishForeground(targetLease, () => {
        surface.focusComposer({ force: true });
      })
        ? target.view
        : null;
    }

    if (!isAttachedChatView(target.leaf.view)) await this.loadDeferredPanelLeaf(target.leaf);
    if (!this.panelTargetLeaseIsCurrent(targetLease)) return null;
    if (isAttachedChatView(target.leaf.view)) {
      const view = target.leaf.view;
      const loadedLease = this.captureLoadedRestoredTargetLease(targetLease, view);
      const surface = workspacePanelSurface(view);
      await surface.connect();
      if (!this.panelTargetLeaseIsCurrent(loadedLease)) return null;
      await surface.focusThread(null, { focus: false });
      if (!this.panelTargetLeaseIsCurrent(loadedLease)) return null;
      return this.publishForeground(loadedLease, () => {
        surface.focusComposer({ force: true });
      })
        ? view
        : null;
    }

    return this.activateNewViewNow({}, targetLease);
  }

  private async openThreadInTarget(target: ThreadPanelTarget, threadId: string, targetLease: WorkspacePanelTargetLease): Promise<boolean> {
    switch (target.kind) {
      case "open":
        if (!(await this.revealForeground(targetLease, target.leaf))) return false;
        await workspacePanelSurface(target.view).focusThread(threadId, { focus: false });
        if (!this.panelTargetLeaseIsCurrent(targetLease)) return false;
        return this.publishForeground(targetLease, () => {
          workspacePanelSurface(target.view).focusComposer({ force: true });
        });
      case "restored":
        if (!(await this.revealForeground(targetLease, target.leaf))) return false;
        if (!isAttachedChatView(target.leaf.view)) await this.loadDeferredPanelLeaf(target.leaf);
        if (!this.panelTargetLeaseIsCurrent(targetLease)) return false;
        if (isAttachedChatView(target.leaf.view)) {
          const loadedLease = this.captureLoadedRestoredTargetLease(targetLease, target.leaf.view);
          const view = target.leaf.view;
          await workspacePanelSurface(view).focusThread(threadId, { focus: false });
          if (!this.panelTargetLeaseIsCurrent(loadedLease)) return false;
          return this.publishForeground(loadedLease, () => {
            workspacePanelSurface(view).focusComposer({ force: true });
          });
        } else {
          if (!(await this.openThreadInNewViewNow(threadId, targetLease))) return false;
        }
        return this.panelTargetLeaseIsCurrent(targetLease);
      case "restored-reuse":
        if (!(await this.revealForeground(targetLease, target.leaf))) return false;
        if (!isAttachedChatView(target.leaf.view)) await this.loadDeferredPanelLeaf(target.leaf);
        if (!this.panelTargetLeaseIsCurrent(targetLease)) return false;
        if (isAttachedChatView(target.leaf.view)) {
          const loadedLease = this.captureLoadedRestoredTargetLease(targetLease, target.leaf.view);
          const view = target.leaf.view;
          await workspacePanelSurface(view).openThread(threadId, { focus: false });
          if (!this.panelTargetLeaseIsCurrent(loadedLease)) return false;
          return this.publishForeground(loadedLease, () => {
            workspacePanelSurface(view).focusComposer({ force: true });
          });
        } else {
          if (!(await this.openThreadInNewViewNow(threadId, targetLease))) return false;
        }
        return this.panelTargetLeaseIsCurrent(targetLease);
      case "empty":
      case "reuse":
        if (!(await this.revealForeground(targetLease, target.leaf))) return false;
        await workspacePanelSurface(target.view).openThread(threadId, { focus: false });
        if (!this.panelTargetLeaseIsCurrent(targetLease)) return false;
        return this.publishForeground(targetLease, () => {
          workspacePanelSurface(target.view).focusComposer({ force: true });
        });
      case "new":
        if (!this.panelTargetLeaseIsCurrent(targetLease)) return false;
        return this.openThreadInNewViewNow(threadId, targetLease);
    }
  }

  private async openThreadInNewViewNow(threadId: string, targetLease: WorkspacePanelTargetLease): Promise<boolean> {
    const view = await this.activateNewViewNow({ connect: false, focus: false }, targetLease);
    if (!view) return false;
    const materializedLease = this.captureViewTargetLease(view, targetLease.revision);
    if (!materializedLease) return false;
    await workspacePanelSurface(view).openThread(threadId, { focus: false });
    if (!this.panelTargetLeaseIsCurrent(materializedLease)) return false;
    return this.publishForeground(materializedLease, () => {
      workspacePanelSurface(view).focusComposer({ force: true });
    });
  }

  private capturePanelTargetLease(target: ThreadPanelTarget, revision: number): WorkspacePanelTargetLease {
    if (target.kind === "new") return { revision, leaf: null, expectedView: null, expectedRestoredThreadId: null };
    return {
      revision,
      leaf: target.leaf,
      expectedView: "view" in target ? target.view : null,
      expectedRestoredThreadId: "view" in target ? null : restoredThreadId(target.leaf),
    };
  }

  private captureLoadedRestoredTargetLease(lease: WorkspacePanelTargetLease, view: CodexChatView): WorkspaceMaterializedPanelTargetLease {
    if (!lease.leaf) throw new Error("A restored panel lease must retain its leaf.");
    return { ...lease, leaf: lease.leaf, expectedView: view, expectedRestoredThreadId: null };
  }

  private captureMaterializedTargetLease(
    lease: WorkspacePanelTargetLease,
    leaf: WorkspaceLeaf,
    view: CodexChatView,
  ): WorkspaceMaterializedPanelTargetLease {
    return { ...lease, leaf, expectedView: view, expectedRestoredThreadId: null };
  }

  private captureViewTargetLease(view: CodexChatView, revision: number): WorkspaceMaterializedPanelTargetLease | null {
    const leaf = this.panelLeaves().find((candidate) => candidate.view === view);
    return leaf ? { revision, leaf, expectedView: view, expectedRestoredThreadId: null } : null;
  }

  private panelTargetLeaseIsCurrent(lease: WorkspacePanelTargetLease): boolean {
    if (this.foregroundIntentRevision !== lease.revision) return false;
    if (!lease.leaf) return true;
    if (!this.panelLeaves().includes(lease.leaf)) return false;
    if (lease.expectedView) return lease.leaf.view === lease.expectedView;
    if (lease.expectedRestoredThreadId) {
      return isAttachedChatView(lease.leaf.view)
        ? workspacePanelSurface(lease.leaf.view).openPanelSnapshot().threadId === lease.expectedRestoredThreadId
        : restoredThreadId(lease.leaf) === lease.expectedRestoredThreadId;
    }
    return lease.leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL;
  }

  private runForegroundIntent<T>(operation: (revision: number) => Promise<T>): Promise<T> {
    return operation(++this.foregroundIntentRevision);
  }

  private async revealForeground(lease: WorkspacePanelTargetLease, leaf: WorkspaceLeaf): Promise<boolean> {
    if (!this.panelTargetLeaseIsCurrent(lease)) return false;
    this.invokingForegroundRevealLeaf = leaf;
    let reveal: Promise<void>;
    try {
      reveal = this.options.app.workspace.revealLeaf(leaf);
    } finally {
      this.invokingForegroundRevealLeaf = null;
    }
    await reveal;
    return this.panelTargetLeaseIsCurrent(lease);
  }

  private publishForeground(lease: WorkspacePanelTargetLease, publish: () => void): boolean {
    if (!this.panelTargetLeaseIsCurrent(lease)) return false;
    publish();
    return this.panelTargetLeaseIsCurrent(lease);
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

  private ensureWorkspacePanelReconcileScheduled(): Extract<WorkspacePanelReconcileScheduleState, { kind: "scheduled" }> | null {
    if (this.workspacePanelReconcileSchedule.kind === "cancelled") return null;
    if (this.workspacePanelReconcileSchedule.kind === "scheduled") return this.workspacePanelReconcileSchedule;
    const lifecycle: Extract<WorkspacePanelReconcileScheduleState, { kind: "scheduled" }> = { kind: "scheduled", timers: new Set() };
    this.workspacePanelReconcileSchedule = lifecycle;
    return lifecycle;
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
