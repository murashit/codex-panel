import type { App, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../constants";
import { CodexChatView } from "../features/chat/host/view";
import type { OpenCodexPanelSnapshot } from "./open-panel-snapshot";

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

export interface WorkspacePanelCoordinatorOptions {
  app: App;
  refreshThreadsViewLiveState: () => void;
}

export class WorkspacePanelCoordinator {
  private bootRestoredPanelLoadLifecycle: BootRestoredPanelLoadLifecycleState = { kind: "idle" };
  private lastFocusedPanelViewId: string | null = null;

  constructor(private readonly options: WorkspacePanelCoordinatorOptions) {}

  reset(): void {
    this.bootRestoredPanelLoadLifecycle = { kind: "idle" };
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
    await view.connect();
    view.focusComposer();
    return view;
  }

  async activateNewView(options: { connect?: boolean } = {}): Promise<CodexChatView> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true });
    await this.options.app.workspace.revealLeaf(leaf);
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

  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[] {
    const leaves = this.panelLeaves();
    this.ensureInitialFocusedPanel(leaves);
    return leaves.flatMap((leaf) =>
      leaf.view instanceof CodexChatView ? [this.openPanelSnapshotWithFocus(leaf.view.openPanelSnapshot())] : [],
    );
  }

  async focusOpenPanel(viewId: string, threadId: string | null = null): Promise<boolean> {
    for (const leaf of this.panelLeaves()) {
      if (leaf.view instanceof CodexChatView && leaf.view.openPanelSnapshot().viewId === viewId) {
        await this.options.app.workspace.revealLeaf(leaf);
        await leaf.view.focusThread(threadId);
        return true;
      }
    }
    return false;
  }

  recordLastFocusedPanel(leaf: WorkspaceLeaf | null): void {
    const viewId = focusedPanelViewId(leaf);
    if (!viewId) return;
    if (this.lastFocusedPanelViewId === viewId) return;
    this.lastFocusedPanelViewId = viewId;
    this.options.refreshThreadsViewLiveState();
  }

  panelLeavesForThread(threadId: string): WorkspaceLeaf[] {
    return this.panelLeaves().filter((leaf) => {
      if (leaf.view instanceof CodexChatView) return leaf.view.openPanelSnapshot().threadId === threadId;
      return restoredThreadId(leaf) === threadId;
    });
  }

  panelViews(): CodexChatView[] {
    return this.panelLeaves().flatMap((leaf) => (leaf.view instanceof CodexChatView ? [leaf.view] : []));
  }

  scheduleBootRestoredPanelLoads(): void {
    this.scheduleBootRestoredPanelLoadTimer(() => {
      const leaves = this.panelLeaves();
      leaves.forEach((leaf, index) => {
        this.scheduleBootRestoredPanelLoadTimer(() => {
          void this.loadRestoredPanelLeaf(leaf);
        }, index * BOOT_RESTORED_PANEL_LOAD_STAGGER_MS);
      });
    }, BOOT_RESTORED_PANEL_LOAD_DELAY_MS);
  }

  cancelBootRestoredPanelLoads(): void {
    if (this.bootRestoredPanelLoadLifecycle.kind === "scheduled") {
      for (const timer of this.bootRestoredPanelLoadLifecycle.timers) {
        window.clearTimeout(timer);
      }
      this.bootRestoredPanelLoadLifecycle.timers.clear();
    }
    this.bootRestoredPanelLoadLifecycle = { kind: "cancelled" };
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
      if (leaf.view.openPanelSnapshot().threadId !== threadId) continue;
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
      if (!isIdleEmptyPanelSnapshot(leaf.view.openPanelSnapshot())) continue;
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

  private threadPanelTargetFromLeaf(leaf: WorkspaceLeaf): ThreadPanelTarget | null {
    if (leaf.view instanceof CodexChatView) return { kind: "reuse", leaf, view: leaf.view };
    if (leaf.getViewState().type === VIEW_TYPE_CODEX_PANEL) return { kind: "restored-reuse", leaf };
    return null;
  }

  private async activateThreadPanelTarget(target: ThreadPanelTarget): Promise<CodexChatView> {
    if (target.kind === "new") return this.activateNewView();

    await this.options.app.workspace.revealLeaf(target.leaf);
    if ("view" in target) {
      await target.view.connect();
      await target.view.focusThread();
      return target.view;
    }

    await target.leaf.loadIfDeferred();
    if (target.leaf.view instanceof CodexChatView) {
      await target.leaf.view.connect();
      await target.leaf.view.focusThread();
      return target.leaf.view;
    }

    return this.activateNewView();
  }

  private async openThreadInTarget(target: ThreadPanelTarget, threadId: string): Promise<void> {
    switch (target.kind) {
      case "open":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await target.view.focusThread(threadId);
        return;
      case "restored":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await target.leaf.loadIfDeferred();
        if (target.leaf.view instanceof CodexChatView) {
          await target.leaf.view.focusThread(threadId);
        }
        return;
      case "restored-reuse":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await target.leaf.loadIfDeferred();
        if (target.leaf.view instanceof CodexChatView) {
          await target.leaf.view.openThread(threadId);
        }
        return;
      case "empty":
      case "reuse":
        await this.options.app.workspace.revealLeaf(target.leaf);
        await target.view.openThread(threadId);
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

  private openPanelSnapshotWithFocus(snapshot: OpenCodexPanelSnapshot): OpenCodexPanelSnapshot {
    return { ...snapshot, lastFocused: snapshot.viewId === this.lastFocusedPanelViewId };
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

function focusedPanelViewId(leaf: WorkspaceLeaf | null): string | null {
  return leaf?.view instanceof CodexChatView ? leaf.view.openPanelSnapshot().viewId : null;
}

function restoredThreadId(leaf: WorkspaceLeaf): string | null {
  const state = leaf.getViewState().state;
  if (!state || typeof state !== "object") return null;
  const threadId = (state as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}
