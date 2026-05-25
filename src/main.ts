import { Plugin, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { registerSelectionRewriteCommand } from "./features/selection-rewrite/command";
import { CodexChatView } from "./features/chat/view";
import { CodexChatTurnDiffView } from "./features/chat/chat-turn-diff-view";
import type { OpenCodexPanelSnapshot } from "./features/chat/panel-snapshot";
import { CodexThreadsView } from "./features/threads-view/view";
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
      kind: "empty";
      leaf: WorkspaceLeaf;
      view: CodexChatView;
    }
  | {
      kind: "new";
    };

export default class CodexPanelPlugin extends Plugin {
  settings: CodexPanelSettings = DEFAULT_SETTINGS;
  vaultPath = "";
  private bootRestoredPanelLoadCancelled = false;
  private readonly bootRestoredPanelLoadTimers = new Set<number>();

  override async onload(): Promise<void> {
    this.bootRestoredPanelLoadCancelled = false;
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
    this.bootRestoredPanelLoadCancelled = true;
    for (const timer of this.bootRestoredPanelLoadTimers) {
      window.clearTimeout(timer);
    }
    this.bootRestoredPanelLoadTimers.clear();
  }

  async activateView(): Promise<CodexChatView> {
    const leaf = await this.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: true,
      reveal: true,
    });
    const view = leaf.view as CodexChatView;
    await view.connect();
    return view;
  }

  async activateNewView(options: { connect?: boolean } = {}): Promise<CodexChatView> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view as CodexChatView;
    if (options.connect !== false) await view.connect();
    return view;
  }

  async openThreadInNewView(threadId: string): Promise<CodexChatView> {
    const view = await this.activateThreadResumeView();
    await view.openThread(threadId);
    return view;
  }

  async openThreadInAvailableView(threadId: string): Promise<void> {
    const target = this.findThreadPanelTarget(threadId);
    await this.openThreadInTarget(target, threadId);
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

  refreshOpenThreadLists(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexChatView) {
        leaf.view.refreshThreadList();
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_THREADS)) {
      if (leaf.view instanceof CodexThreadsView) {
        void leaf.view.refresh();
      }
    }
  }

  refreshThreadsViewLiveState(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_THREADS)) {
      if (leaf.view instanceof CodexThreadsView) {
        leaf.view.refreshLiveState();
      }
    }
  }

  refreshThreadsViewThreadList(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_THREADS)) {
      if (leaf.view instanceof CodexThreadsView) {
        void leaf.view.refresh();
      }
    }
  }

  notifyThreadArchived(threadId: string): void {
    this.notifyOpenPanels((view) => {
      view.notifyThreadArchived(threadId);
    });
    this.refreshThreadSurfaces();
  }

  notifyThreadRenamed(threadId: string, name: string): void {
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
      case "empty":
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
    this.refreshOpenThreadLists();
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
    const timer = window.setTimeout(() => {
      this.bootRestoredPanelLoadTimers.delete(timer);
      if (this.bootRestoredPanelLoadCancelled) return;
      callback();
    }, delay);
    this.bootRestoredPanelLoadTimers.add(timer);
  }

  private async loadRestoredPanelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (this.bootRestoredPanelLoadCancelled) return;
    try {
      await leaf.loadIfDeferred();
    } catch (error) {
      console.warn("Codex Panel could not hydrate a restored panel leaf.", error);
    }
  }
}

function isIdleEmptyPanelSnapshot(snapshot: OpenCodexPanelSnapshot): boolean {
  return (
    snapshot.threadId === null &&
    !snapshot.busy &&
    snapshot.activeTurnId === null &&
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
