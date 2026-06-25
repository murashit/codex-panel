import { Plugin } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { CodexChatView } from "./features/chat/host/view";
import { CodexChatTurnDiffView } from "./features/chat/ui/turn-diff/view.obsidian";
import { registerSelectionRewriteCommand } from "./features/selection-rewrite/command";
import { CodexThreadsView } from "./features/threads-view/view";
import { CodexPanelRuntime } from "./plugin-runtime";
import { type CodexPanelSettings, DEFAULT_SETTINGS, getVaultPath, normalizeSettings, settingsMatchNormalizedData } from "./settings/model";
import { CodexPanelSettingTab } from "./settings/tab.obsidian";

export default class CodexPanelPlugin extends Plugin {
  settings: CodexPanelSettings = DEFAULT_SETTINGS;
  vaultPath = "";
  readonly runtime = new CodexPanelRuntime({
    app: this.app,
    settingsRef: this,
    saveSettings: () => this.saveSettings(),
  });

  override async onload(): Promise<void> {
    this.runtime.reset();
    this.vaultPath = getVaultPath(this.app);
    await this.loadSettings();

    this.registerView(VIEW_TYPE_CODEX_PANEL, (leaf) => new CodexChatView(leaf, this.runtime.chatHost()));
    this.registerView(VIEW_TYPE_CODEX_TURN_DIFF, (leaf) => new CodexChatTurnDiffView(leaf));
    this.registerView(VIEW_TYPE_CODEX_THREADS, (leaf) => new CodexThreadsView(leaf, this.runtime.threadsHost()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.runtime.reconcileWorkspacePanels(leaf);
      }),
    );

    this.addRibbonIcon("bot-message-square", "Open panel", () => {
      void this.runtime.activatePanel();
    });

    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => void this.runtime.activatePanel(),
    });

    this.addCommand({
      id: "open-new-panel",
      name: "Open new panel",
      callback: () => void this.runtime.activateNewPanel(),
    });

    this.addCommand({
      id: "open-threads-view",
      name: "Open threads view",
      callback: () => void this.runtime.activateThreadsView(),
    });

    this.addCommand({
      id: "open-thread",
      name: "Open thread...",
      callback: () => {
        this.runtime.openThreadPicker();
      },
    });

    this.addCommand({
      id: "new-chat",
      name: "Start new chat",
      callback: () => void this.runtime.startNewChat(),
    });

    registerSelectionRewriteCommand(this);

    this.addSettingTab(new CodexPanelSettingTab(this.app, this, this.runtime.settingTabHost()));

    this.runtime.scheduleWorkspacePanelReconcile();
  }

  override onunload(): void {
    this.runtime.cancelWorkspacePanelReconcile();
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
}
