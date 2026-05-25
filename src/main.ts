import { Plugin, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { registerSelectionRewriteCommand } from "./features/selection-rewrite/command";
import { CodexChatView } from "./features/chat/view";
import { CodexChatTurnDiffView } from "./features/chat/chat-turn-diff-view";
import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData, type CodexPanelSettings } from "./settings/model";
import { CodexPanelSettingTab } from "./settings/tab";
import { persistedChatTurnDiffViewState, type ChatTurnDiffViewState } from "./features/chat/ui/turn-diff";

const BOOT_RESTORED_PANEL_LOAD_DELAY_MS = 1_000;
const BOOT_RESTORED_PANEL_LOAD_STAGGER_MS = 250;

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
      id: "new-chat",
      name: "New chat",
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

  async activateNewView(): Promise<CodexChatView> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view as CodexChatView;
    await view.connect();
    return view;
  }

  async openThreadInNewView(threadId: string): Promise<CodexChatView> {
    const view = await this.activateNewView();
    await view.openThread(threadId);
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
