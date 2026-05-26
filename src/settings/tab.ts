import { type App, Notice, PluginSettingTab, Setting } from "obsidian";

import type { AppServerClient } from "../app-server/client";
import { withAppServerSession } from "../app-server/session-client";
import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { HookMetadata } from "../generated/app-server/v2/HookMetadata";
import type { Model } from "../generated/app-server/v2/Model";
import type { Thread } from "../generated/app-server/v2/Thread";
import type CodexPanelPlugin from "../main";
import { findModelByIdOrName, REASONING_EFFORTS, sortedAvailableModels, supportedEffortsForModel } from "../runtime/model";
import { archivedThreadDisplayTitle } from "../domain/threads/model";
import { errorMessage } from "../utils";
import { loadHookData, loadSettingsData } from "./data";
import { renderArchivedThreadSection, renderHookSection } from "./dynamic-sections";

const CODEX_DEFAULT_VALUE = "__codex-default__";
const SEND_SHORTCUT_LABELS = {
  enter: "Enter",
  "mod-enter": "Cmd/Ctrl+Enter",
} as const;

function renderSettingsHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl).setClass("codex-panel-settings__section-heading").setHeading().setName(name);
}

export class CodexPanelSettingTab extends PluginSettingTab {
  private settingsDataAutoLoadStarted = false;
  private settingsDataLoading = false;
  private archivedThreads: Thread[] = [];
  private archivedThreadsLoaded = false;
  private archivedThreadsLoading = false;
  private archivedThreadsStatus = "";
  private hooks: HookMetadata[] = [];
  private hookWarnings: string[] = [];
  private hookErrors: string[] = [];
  private hooksLoaded = false;
  private hooksLoading = false;
  private hooksStatus = "";
  private models: Model[] = [];
  private modelsLoading = false;
  private modelsStatus = "";

  constructor(
    app: App,
    private readonly plugin: CodexPanelPlugin,
  ) {
    super(app, plugin);
    this.models = plugin.cachedModels();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-panel-settings");

    const configSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__general-section" });
    configSection.createEl("p", {
      cls: "setting-item-description codex-panel-settings__section-intro",
      text: "Codex Panel stores only panel preferences. Models, sandboxing, approvals, MCP servers, hooks, and network access still come from Codex config.",
    });

    new Setting(configSection)
      .setName("Codex executable")
      .setDesc("Path used to start `codex app-server`. Use an absolute path if Obsidian cannot find `codex`.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_CODEX_PATH)
          .setValue(this.plugin.settings.codexPath)
          .onChange(async (value) => {
            this.plugin.settings.codexPath = value.trim() || DEFAULT_CODEX_PATH;
            await this.plugin.saveSettings();
          });
      });

    new Setting(configSection)
      .setName("Codex data")
      .setDesc("Refresh models, hooks, and archived threads from Codex app server.")
      .addButton((button) => {
        button
          .setButtonText(this.settingsDataLoading ? "Refreshing..." : "Refresh Codex data")
          .setDisabled(this.settingsDataLoading)
          .onClick(() => void this.refreshSettingsData());
      });

    const composerSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__composer-section" });
    renderSettingsHeading(composerSection, "Composer");
    new Setting(composerSection)
      .setName("Send shortcut")
      .setDesc(
        "Choose how the composer sends messages. Shift+Enter inserts a newline when Enter sends. Obsidian hotkeys may intercept Cmd/Ctrl+Enter.",
      )
      .addDropdown((dropdown) => {
        dropdown.selectEl.ariaLabel = "Send shortcut";
        dropdown.addOption("enter", SEND_SHORTCUT_LABELS.enter);
        dropdown.addOption("mod-enter", SEND_SHORTCUT_LABELS["mod-enter"]);
        dropdown.setValue(this.plugin.settings.sendShortcut).onChange(async (value) => {
          this.plugin.settings.sendShortcut = value === "mod-enter" ? "mod-enter" : "enter";
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const helperSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__helper-section" });
    renderSettingsHeading(helperSection, "Codex helpers");
    new Setting(helperSection)
      .setName("Automatic thread naming")
      .setDesc("Choose the model and reasoning effort used to suggest thread names.")
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.threadNamingModel;
        const options = this.modelOptions();
        dropdown.selectEl.ariaLabel = "Automatic thread naming model";
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        if (current && !options.some((model) => model.model === current || model.id === current)) {
          dropdown.addOption(current, `${current} (saved)`);
        }
        for (const model of options) {
          dropdown.addOption(model.model, model.model);
        }
        dropdown.setValue(current ?? CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.threadNamingModel = value === CODEX_DEFAULT_VALUE ? null : value;
          if (!this.namingEffortSupported(this.plugin.settings.threadNamingEffort)) {
            this.plugin.settings.threadNamingEffort = null;
          }
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.threadNamingEffort;
        const options = this.effortOptions(this.plugin.settings.threadNamingModel);
        dropdown.selectEl.ariaLabel = "Automatic thread naming effort";
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        for (const effort of options) {
          dropdown.addOption(effort, effort);
        }
        dropdown.setValue(current && options.includes(current) ? current : CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.threadNamingEffort = value === CODEX_DEFAULT_VALUE ? null : (value as ReasoningEffort);
          await this.plugin.saveSettings();
        });
      });

    new Setting(helperSection)
      .setName("Selection rewrite")
      .setDesc("Choose the model and reasoning effort used by rewrite selection.")
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.rewriteSelectionModel;
        const options = this.modelOptions();
        dropdown.selectEl.ariaLabel = "Selection rewrite model";
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        if (current && !options.some((model) => model.model === current || model.id === current)) {
          dropdown.addOption(current, `${current} (saved)`);
        }
        for (const model of options) {
          dropdown.addOption(model.model, model.model);
        }
        dropdown.setValue(current ?? CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.rewriteSelectionModel = value === CODEX_DEFAULT_VALUE ? null : value;
          if (!this.rewriteSelectionEffortSupported(this.plugin.settings.rewriteSelectionEffort)) {
            this.plugin.settings.rewriteSelectionEffort = null;
          }
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.rewriteSelectionEffort;
        const options = this.effortOptions(this.plugin.settings.rewriteSelectionModel);
        dropdown.selectEl.ariaLabel = "Selection rewrite effort";
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        for (const effort of options) {
          dropdown.addOption(effort, effort);
        }
        dropdown.setValue(current && options.includes(current) ? current : CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.rewriteSelectionEffort = value === CODEX_DEFAULT_VALUE ? null : (value as ReasoningEffort);
          await this.plugin.saveSettings();
        });
      });
    if (this.modelsLoading || (this.modelsStatus && !this.modelsStatus.startsWith("Loaded "))) {
      configSection.createEl("p", {
        cls: "setting-item-description codex-panel-settings__section-status",
        text: this.modelsStatus || "Loading models...",
      });
    }

    renderArchivedThreadSection(containerEl, {
      exportEnabled: this.plugin.settings.archiveExportEnabled,
      exportFolderTemplate: this.plugin.settings.archiveExportFolderTemplate,
      exportFilenameTemplate: this.plugin.settings.archiveExportFilenameTemplate,
      exportTags: this.plugin.settings.archiveExportTags,
      threads: this.archivedThreads,
      loaded: this.archivedThreadsLoaded,
      loading: this.archivedThreadsLoading,
      status: this.archivedThreadsStatus,
      onExportEnabledChange: (enabled) => void this.setArchiveExportEnabled(enabled),
      onExportFolderTemplateChange: (value) => void this.setArchiveExportFolderTemplate(value),
      onExportFilenameTemplateChange: (value) => void this.setArchiveExportFilenameTemplate(value),
      onExportTagsChange: (value) => void this.setArchiveExportTags(value),
      onRestore: (threadId) => void this.restoreArchivedThread(threadId),
    });

    renderHookSection(containerEl, {
      hooks: this.hooks,
      warnings: this.hookWarnings,
      errors: this.hookErrors,
      loaded: this.hooksLoaded,
      loading: this.hooksLoading,
      status: this.hooksStatus,
      onTrust: (hook) => void this.trustHook(hook),
      onToggleEnabled: (hook, enabled) => void this.setHookEnabled(hook, enabled),
    });

    this.maybeAutoLoadSettingsData();
  }

  private maybeAutoLoadSettingsData(): void {
    if (this.settingsDataAutoLoadStarted || this.settingsDataLoading) return;
    this.settingsDataAutoLoadStarted = true;
    void this.refreshSettingsData();
  }

  private async refreshSettingsData(): Promise<void> {
    this.settingsDataLoading = true;
    this.modelsLoading = true;
    this.archivedThreadsLoading = true;
    this.hooksLoading = true;
    this.modelsStatus = "Loading models...";
    this.archivedThreadsStatus = "Loading archived threads...";
    this.hooksStatus = "Loading hooks...";
    this.display();

    let failedCount = 0;
    try {
      const result = await this.withSettingsSession((client) => loadSettingsData(client, this.plugin.vaultPath));

      if (result.models.ok) {
        this.models = result.models.data;
        this.plugin.publishModels(result.models.data);
        this.modelsStatus = result.models.status;
      } else {
        failedCount += 1;
        this.modelsStatus = result.models.status;
      }

      if (result.hooks.ok) {
        this.hooks = result.hooks.data.hooks;
        this.hookWarnings = result.hooks.data.warnings;
        this.hookErrors = result.hooks.data.errors;
        this.hooksLoaded = true;
        this.hooksStatus = result.hooks.status;
      } else {
        failedCount += 1;
        this.hooksStatus = result.hooks.status;
      }

      if (result.archivedThreads.ok) {
        this.archivedThreads = result.archivedThreads.data;
        this.archivedThreadsLoaded = true;
        this.archivedThreadsStatus = result.archivedThreads.status;
      } else {
        failedCount += 1;
        this.archivedThreadsStatus = result.archivedThreads.status;
      }
    } catch (error) {
      failedCount = 3;
      const message = errorMessage(error);
      this.modelsStatus = `Could not load models: ${message}`;
      this.hooksStatus = `Could not load hooks: ${message}`;
      this.archivedThreadsStatus = `Could not load archived threads: ${message}`;
    } finally {
      this.settingsDataLoading = false;
      this.modelsLoading = false;
      this.archivedThreadsLoading = false;
      this.hooksLoading = false;
      if (failedCount > 0) {
        new Notice("Could not refresh all Codex data.");
      }
      this.display();
    }
  }

  private async loadHooks(): Promise<void> {
    this.hooksLoading = true;
    this.hooksStatus = "";
    this.display();
    try {
      const hooks = await this.withSettingsSession((client) => loadHookData(client, this.plugin.vaultPath));
      this.hooks = hooks.hooks;
      this.hookWarnings = hooks.warnings;
      this.hookErrors = hooks.errors;
      this.hooksLoaded = true;
      this.hooksStatus = hooks.status;
    } catch (error) {
      this.hooksStatus = `Could not load hooks: ${errorMessage(error)}`;
      new Notice("Could not load Codex hooks.");
    } finally {
      this.hooksLoading = false;
      this.display();
    }
  }

  private async trustHook(hook: HookMetadata): Promise<void> {
    this.hooksLoading = true;
    this.hooksStatus = "";
    this.display();
    try {
      await this.withSettingsSession((client) => client.trustHook(hook));
      this.hooksStatus = "Trusted hook definition.";
      await this.loadHooks();
    } catch (error) {
      this.hooksStatus = `Could not trust hook: ${errorMessage(error)}`;
      new Notice("Could not trust Codex hook.");
      this.hooksLoading = false;
      this.display();
    }
  }

  private async setHookEnabled(hook: HookMetadata, enabled: boolean): Promise<void> {
    this.hooksLoading = true;
    this.hooksStatus = "";
    this.display();
    try {
      await this.withSettingsSession((client) => client.setHookEnabled(hook, enabled));
      this.hooksStatus = enabled ? "Enabled hook." : "Disabled hook.";
      await this.loadHooks();
    } catch (error) {
      this.hooksStatus = `Could not update hook: ${errorMessage(error)}`;
      new Notice("Could not update Codex hook.");
      this.hooksLoading = false;
      this.display();
    }
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

  private async restoreArchivedThread(threadId: string): Promise<void> {
    this.archivedThreadsLoading = true;
    this.archivedThreadsStatus = "";
    this.display();
    try {
      const response = await this.withSettingsSession((client) => client.unarchiveThread(threadId));
      this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
      this.archivedThreadsLoaded = true;
      this.archivedThreadsStatus = `Restored "${archivedThreadDisplayTitle(response.thread)}".`;
      this.plugin.refreshSharedThreadListFromOpenSurface();
    } catch (error) {
      this.archivedThreadsStatus = `Could not restore archived thread: ${errorMessage(error)}`;
      new Notice("Could not restore archived Codex thread.");
    } finally {
      this.archivedThreadsLoading = false;
      this.display();
    }
  }

  private async withSettingsSession<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    return withAppServerSession(this.plugin.settings.codexPath, this.plugin.vaultPath, operation);
  }

  private modelOptions(): Model[] {
    return sortedAvailableModels(this.models);
  }

  private effortOptions(modelIdOrName: string | null): ReasoningEffort[] {
    const model = this.selectedModel(modelIdOrName);
    return model ? supportedEffortsForModel(model) : REASONING_EFFORTS;
  }

  private namingEffortSupported(effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(this.plugin.settings.threadNamingModel).includes(effort);
  }

  private rewriteSelectionEffortSupported(effort: ReasoningEffort | null): boolean {
    return !effort || this.effortOptions(this.plugin.settings.rewriteSelectionModel).includes(effort);
  }

  private selectedModel(modelIdOrName: string | null): Model | null {
    return findModelByIdOrName(this.models, modelIdOrName);
  }
}
