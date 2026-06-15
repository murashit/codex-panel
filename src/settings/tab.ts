import { type App, Notice, type Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";

import { DEFAULT_CODEX_PATH } from "../constants";
import { SettingsDynamicDataController, type SettingsDynamicDataHost } from "./dynamic-data-controller";
import { renderArchivedThreadSection, renderHookSection } from "./dynamic-sections";

const CODEX_DEFAULT_VALUE = "__codex-default__";
const SETTINGS_INTRO_TEXT =
  "Codex Panel stores only panel preferences. Models, sandboxing, approvals, MCP servers, hooks, and network access still come from Codex config.";
const SEND_SHORTCUT_LABELS = {
  enter: "Enter",
  "mod-enter": "Cmd/Ctrl+Enter",
} as const;

function renderSettingsHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl).setClass("codex-panel-settings__section-heading").setHeading().setName(name);
}

export class CodexPanelSettingTab extends PluginSettingTab {
  private readonly dynamicData: SettingsDynamicDataController;

  constructor(
    app: App,
    owner: Plugin,
    private readonly plugin: CodexPanelSettingTabHost,
  ) {
    super(app, owner);
    this.dynamicData = new SettingsDynamicDataController(plugin, {
      display: () => {
        this.display();
      },
      notify: (message) => {
        new Notice(message);
      },
    });
  }

  display(): void {
    this.dynamicData.activate();
    this.renderSettingsTab({ autoLoadCodexData: true });
  }

  override hide(): void {
    this.dynamicData.dispose();
    super.hide();
  }

  private renderSettingsTab(options: { autoLoadCodexData: boolean }): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-panel-settings");

    this.renderHeaderActions(containerEl, SETTINGS_INTRO_TEXT);
    this.renderPanelPreferenceSections(containerEl);
    this.renderCodexDynamicSections(containerEl);

    if (options.autoLoadCodexData) this.maybeAutoLoadSettingsData();
  }

  private renderPanelPreferenceSections(containerEl: HTMLElement): void {
    const configSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__general-section" });

    new Setting(configSection)
      .setName("Codex executable")
      .setDesc("Path used to start `codex app-server`. Use an absolute path if Obsidian cannot find `codex`.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_CODEX_PATH)
          .setValue(this.plugin.settings.codexPath)
          .onChange(async (value) => {
            const codexPath = value.trim() || DEFAULT_CODEX_PATH;
            const codexPathChanged = codexPath !== this.plugin.settings.codexPath;
            this.plugin.settings.codexPath = codexPath;
            await this.plugin.saveSettings();
            if (codexPathChanged) {
              this.dynamicData.resetSettingsDataContext();
              this.plugin.threadCatalog.notifyAppServerQueryContextChanged();
              this.plugin.refreshOpenViews();
              this.renderSettingsTab({ autoLoadCodexData: false });
            }
          });
      });
    new Setting(configSection)
      .setName("Show chat toolbar")
      .setDesc("Show the chat panel toolbar. Slash commands, composer status controls, and the threads view remain available when hidden.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showToolbar).onChange(async (value) => {
          this.plugin.settings.showToolbar = value;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        });
      });

    const composerSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__composer-section" });
    renderSettingsHeading(composerSection, "Composer");
    new Setting(composerSection)
      .setName("Send shortcut")
      .setDesc(
        "Choose how the composer sends messages. Shift+Enter inserts a newline when Enter sends. Obsidian hotkeys may intercept Cmd/Ctrl+Enter.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("enter", SEND_SHORTCUT_LABELS.enter);
        dropdown.addOption("mod-enter", SEND_SHORTCUT_LABELS["mod-enter"]);
        dropdown.setValue(this.plugin.settings.sendShortcut).onChange(async (value) => {
          this.plugin.settings.sendShortcut = value === "mod-enter" ? "mod-enter" : "enter";
          await this.plugin.saveSettings();
          this.display();
        });
      });
    new Setting(composerSection)
      .setName("Scroll thread from composer edges")
      .setDesc("When enabled, Up/Ctrl+P on the first composer line and Down/Ctrl+N on the last line scroll the thread.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.scrollThreadFromComposerEdges).onChange(async (value) => {
          this.plugin.settings.scrollThreadFromComposerEdges = value;
          await this.plugin.saveSettings();
        });
      });

    const helperSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__helper-section" });
    renderSettingsHeading(helperSection, "Codex helpers");
    new Setting(helperSection)
      .setName("Automatic thread naming")
      .setDesc("Choose the model and reasoning effort used to suggest thread names.")
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.threadNamingModel;
        const options = this.dynamicData.modelMetadata();
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        if (current && !options.some((model) => model.model === current || model.id === current)) {
          dropdown.addOption(current, `${current} (saved)`);
        }
        for (const model of options) {
          dropdown.addOption(model.model, model.model);
        }
        dropdown.setValue(current ?? CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.threadNamingModel = value === CODEX_DEFAULT_VALUE ? null : value;
          if (!this.dynamicData.namingEffortSupported(this.plugin.settings.threadNamingEffort)) {
            this.plugin.settings.threadNamingEffort = null;
          }
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.threadNamingEffort;
        const options = this.dynamicData.effortOptions(this.plugin.settings.threadNamingModel);
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        if (current && !options.includes(current)) {
          dropdown.addOption(current, `${current} (saved)`);
        }
        for (const effort of options) {
          dropdown.addOption(effort, effort);
        }
        dropdown.setValue(current ?? CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.threadNamingEffort = value === CODEX_DEFAULT_VALUE ? null : value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(helperSection)
      .setName("Selection rewrite")
      .setDesc("Choose the model and reasoning effort used by rewrite selection.")
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.rewriteSelectionModel;
        const options = this.dynamicData.modelMetadata();
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        if (current && !options.some((model) => model.model === current || model.id === current)) {
          dropdown.addOption(current, `${current} (saved)`);
        }
        for (const model of options) {
          dropdown.addOption(model.model, model.model);
        }
        dropdown.setValue(current ?? CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.rewriteSelectionModel = value === CODEX_DEFAULT_VALUE ? null : value;
          if (!this.dynamicData.rewriteSelectionEffortSupported(this.plugin.settings.rewriteSelectionEffort)) {
            this.plugin.settings.rewriteSelectionEffort = null;
          }
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.rewriteSelectionEffort;
        const options = this.dynamicData.effortOptions(this.plugin.settings.rewriteSelectionModel);
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        if (current && !options.includes(current)) {
          dropdown.addOption(current, `${current} (saved)`);
        }
        for (const effort of options) {
          dropdown.addOption(effort, effort);
        }
        dropdown.setValue(current ?? CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.rewriteSelectionEffort = value === CODEX_DEFAULT_VALUE ? null : value;
          await this.plugin.saveSettings();
        });
      });
    const dynamicData = this.dynamicData.snapshot();
    if (dynamicData.modelsLifecycle.kind === "failed") {
      configSection.createEl("p", {
        cls: "setting-item-description codex-panel-settings__section-status",
        text: dynamicData.modelsLifecycle.status,
      });
    }
  }

  private renderCodexDynamicSections(containerEl: HTMLElement): void {
    const dynamicData = this.dynamicData.snapshot();
    renderArchivedThreadSection(containerEl, {
      exportEnabled: this.plugin.settings.archiveExportEnabled,
      exportFolderTemplate: this.plugin.settings.archiveExportFolderTemplate,
      exportFilenameTemplate: this.plugin.settings.archiveExportFilenameTemplate,
      exportTags: this.plugin.settings.archiveExportTags,
      threads: dynamicData.archivedThreads,
      loaded: dynamicData.archivedThreadsLifecycle.kind === "loaded",
      loading: dynamicData.archivedThreadsLifecycle.kind === "loading",
      status: dynamicData.archivedThreadsLifecycle.status,
      onExportEnabledChange: (enabled) => void this.setArchiveExportEnabled(enabled),
      onExportFolderTemplateChange: (value) => void this.setArchiveExportFolderTemplate(value),
      onExportFilenameTemplateChange: (value) => void this.setArchiveExportFilenameTemplate(value),
      onExportTagsChange: (value) => void this.setArchiveExportTags(value),
      onRestore: (threadId) => void this.dynamicData.restoreArchivedThread(threadId),
    });

    renderHookSection(containerEl, {
      hooks: dynamicData.hooks,
      warnings: dynamicData.hookWarnings,
      errors: dynamicData.hookErrors,
      loaded: dynamicData.hooksLifecycle.kind === "loaded",
      loading: dynamicData.hooksLifecycle.kind === "loading",
      status: dynamicData.hooksLifecycle.status,
      onTrust: (hook) => void this.dynamicData.trustHook(hook),
      onToggleEnabled: (hook, enabled) => void this.dynamicData.setHookEnabled(hook, enabled),
    });
  }

  private renderHeaderActions(containerEl: HTMLElement, introText: string): void {
    const header = containerEl.createDiv({ cls: "codex-panel-settings__header" });
    header.createEl("span", {
      cls: "setting-item-description codex-panel-settings__section-intro",
      text: introText,
    });
    const button = header.createEl("button", {
      cls: "clickable-icon codex-panel-settings__refresh-button",
    });
    button.type = "button";
    button.disabled = this.dynamicData.settingsDataLoading();
    button.ariaLabel = this.dynamicData.settingsDataLoading() ? "Refreshing Codex data" : "Refresh Codex data";
    setIcon(button, "refresh-cw");
    button.addEventListener("click", () => {
      void this.dynamicData.refreshSettingsData();
    });
  }

  private maybeAutoLoadSettingsData(): void {
    this.dynamicData.maybeAutoLoadSettingsData();
  }

  private async setArchiveExportEnabled(enabled: boolean): Promise<void> {
    this.plugin.settings.archiveExportEnabled = enabled;
    await this.plugin.saveSettings();
    this.display();
  }

  private async setArchiveExportFolderTemplate(value: string): Promise<void> {
    this.plugin.settings.archiveExportFolderTemplate = value.trim();
    await this.plugin.saveSettings();
  }

  private async setArchiveExportFilenameTemplate(value: string): Promise<void> {
    this.plugin.settings.archiveExportFilenameTemplate = value.trim();
    await this.plugin.saveSettings();
  }

  private async setArchiveExportTags(value: string): Promise<void> {
    this.plugin.settings.archiveExportTags = value.trim();
    await this.plugin.saveSettings();
  }
}

export interface CodexPanelSettingTabHost extends SettingsDynamicDataHost {
  saveSettings(): Promise<void>;
  refreshOpenViews(): void;
}
