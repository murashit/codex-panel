import { Plugin, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { registerRewriteSelectionCommand } from "./features/selection-rewrite/command";
import { CodexPanelView } from "./features/chat/view";
import { CodexTurnDiffView } from "./features/chat/turn-diff-view";
import { DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData, type CodexPanelSettings } from "./settings/model";
import { CodexPanelSettingTab } from "./settings/tab";
import { persistedTurnDiffViewState, type TurnDiffViewState } from "./features/chat/ui/turn-diff";

export default class CodexPanelPlugin extends Plugin {
  settings: CodexPanelSettings = DEFAULT_SETTINGS;
  vaultPath = "";

  override async onload(): Promise<void> {
    this.vaultPath = getVaultPath(this.app);
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_PANEL, (leaf) => new CodexPanelView(leaf, this));
    this.registerView(VIEW_TYPE_CODEX_TURN_DIFF, (leaf) => new CodexTurnDiffView(leaf));

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

    registerRewriteSelectionCommand(this);

    this.addSettingTab(new CodexPanelSettingTab(this.app, this));
  }

  async activateView(): Promise<CodexPanelView> {
    const leaf = await this.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_PANEL, "right", {
      active: true,
      reveal: true,
    });
    return leaf.view as CodexPanelView;
  }

  async activateNewView(): Promise<CodexPanelView> {
    const leaf = this.createRightSidebarTab();
    if (!leaf) throw new Error("Could not create a right sidebar leaf.");

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_PANEL, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as CodexPanelView;
  }

  async openThreadInNewView(threadId: string): Promise<CodexPanelView> {
    const view = await this.activateNewView();
    await view.openThread(threadId);
    return view;
  }

  async openTurnDiff(state: TurnDiffViewState): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true, state: { ...persistedTurnDiffViewState(state) } });
    await leaf.loadIfDeferred();
    if (leaf.view instanceof CodexTurnDiffView) {
      leaf.view.setDiffPayload(state);
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexPanelView) {
        leaf.view.refreshSettings();
      }
    }
  }

  refreshOpenThreadLists(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL)) {
      if (leaf.view instanceof CodexPanelView) {
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
}
