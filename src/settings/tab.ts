import { type App, Notice, type Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";

import type { AppServerClient } from "../app-server/client";
import { withShortLivedAppServerClient } from "../app-server/short-lived-client";
import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { HookMetadata } from "../generated/app-server/v2/HookMetadata";
import type { Model } from "../generated/app-server/v2/Model";
import type { Thread } from "../generated/app-server/v2/Thread";
import { findModelByIdOrName, REASONING_EFFORTS, sortedAvailableModels, supportedEffortsForModel } from "../runtime/model";
import { archivedThreadDisplayTitle } from "../domain/threads/model";
import { errorMessage } from "../utils";
import {
  createSettingsDynamicSectionLifecycle,
  loadHookData,
  loadSettingsData,
  transitionSettingsDynamicSectionLifecycle,
  transitionSettingsDataRefreshLifecycle,
  type SettingsDataRefreshLifecycleState,
} from "./data";
import { renderArchivedThreadSection, renderHookSection } from "./dynamic-sections";
import type { CodexPanelSettings } from "./model";

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
  private settingsDataAutoLoadStarted = false;
  private settingsDynamicOperationId = 0;
  private settingsDataRefreshLifecycle: SettingsDataRefreshLifecycleState = { kind: "idle" };
  private archivedThreads: Thread[] = [];
  private archivedThreadsLifecycle = createSettingsDynamicSectionLifecycle();
  private hooks: HookMetadata[] = [];
  private hookWarnings: string[] = [];
  private hookErrors: string[] = [];
  private hooksLifecycle = createSettingsDynamicSectionLifecycle();
  private models: Model[] = [];
  private modelsLifecycle = createSettingsDynamicSectionLifecycle();

  constructor(
    app: App,
    private readonly plugin: CodexPanelSettingTabHost,
  ) {
    super(app, plugin);
    this.models = plugin.cachedModels();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-panel-settings");

    this.renderHeaderActions(containerEl, SETTINGS_INTRO_TEXT);

    const configSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__general-section" });

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
    if (this.modelsLifecycle.kind === "failed") {
      configSection.createEl("p", {
        cls: "setting-item-description codex-panel-settings__section-status",
        text: this.modelsLifecycle.status,
      });
    }

    renderArchivedThreadSection(containerEl, {
      exportEnabled: this.plugin.settings.archiveExportEnabled,
      exportFolderTemplate: this.plugin.settings.archiveExportFolderTemplate,
      exportFilenameTemplate: this.plugin.settings.archiveExportFilenameTemplate,
      exportTags: this.plugin.settings.archiveExportTags,
      threads: this.archivedThreads,
      loaded: this.archivedThreadsLifecycle.kind === "loaded",
      loading: this.archivedThreadsLifecycle.kind === "loading",
      status: this.archivedThreadsLifecycle.status,
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
      loaded: this.hooksLifecycle.kind === "loaded",
      loading: this.hooksLifecycle.kind === "loading",
      status: this.hooksLifecycle.status,
      onTrust: (hook) => void this.trustHook(hook),
      onToggleEnabled: (hook, enabled) => void this.setHookEnabled(hook, enabled),
    });

    this.maybeAutoLoadSettingsData();
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
    button.disabled = this.settingsDataLoading();
    button.ariaLabel = this.settingsDataLoading() ? "Refreshing Codex data" : "Refresh Codex data";
    setIcon(button, "refresh-cw");
    button.addEventListener("click", () => {
      void this.refreshSettingsData();
    });
  }

  private maybeAutoLoadSettingsData(): void {
    if (this.settingsDataAutoLoadStarted || this.settingsDataLoading()) return;
    this.settingsDataAutoLoadStarted = true;
    void this.refreshSettingsData();
  }

  private async refreshSettingsData(): Promise<void> {
    const operationId = this.nextSettingsDynamicOperationId();
    this.settingsDataRefreshLifecycle = transitionSettingsDataRefreshLifecycle(this.settingsDataRefreshLifecycle, { type: "started" });
    this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
      type: "started",
      status: "Loading models...",
      operationId,
    });
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationId,
    });
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.display();

    let failedCount = 0;
    try {
      const result = await this.withSettingsConnection((client) => loadSettingsData(client, this.plugin.vaultPath));

      if (result.models.ok) {
        this.models = result.models.data;
        this.plugin.publishModels(result.models.data);
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "loaded",
          status: result.models.status,
          operationId,
        });
      } else {
        failedCount += 1;
        this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
          type: "failed",
          status: result.models.status,
          operationId,
        });
      }

      if (result.hooks.ok) {
        this.hooks = result.hooks.data.hooks;
        this.hookWarnings = result.hooks.data.warnings;
        this.hookErrors = result.hooks.data.errors;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "loaded",
          status: result.hooks.status,
          operationId,
        });
      } else {
        failedCount += 1;
        this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
          type: "failed",
          status: result.hooks.status,
          operationId,
        });
      }

      if (result.archivedThreads.ok) {
        this.archivedThreads = result.archivedThreads.data;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "loaded",
          status: result.archivedThreads.status,
          operationId,
        });
      } else {
        failedCount += 1;
        this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
          type: "failed",
          status: result.archivedThreads.status,
          operationId,
        });
      }
    } catch (error) {
      failedCount = 3;
      const message = errorMessage(error);
      this.modelsLifecycle = transitionSettingsDynamicSectionLifecycle(this.modelsLifecycle, {
        type: "failed",
        status: `Could not load models: ${message}`,
        operationId,
      });
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not load hooks: ${message}`,
        operationId,
      });
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "failed",
        status: `Could not load archived threads: ${message}`,
        operationId,
      });
    } finally {
      this.settingsDataRefreshLifecycle = transitionSettingsDataRefreshLifecycle(this.settingsDataRefreshLifecycle, {
        type: "completed",
        failedCount,
      });
      if (failedCount > 0) {
        new Notice("Could not refresh all Codex data.");
      }
      this.display();
    }
  }

  private settingsDataLoading(): boolean {
    return this.settingsDataRefreshLifecycle.kind === "loading";
  }

  private async loadHooks(): Promise<void> {
    const operationId = this.nextSettingsDynamicOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.display();
    try {
      const hooks = await this.withSettingsConnection((client) => loadHookData(client, this.plugin.vaultPath));
      this.hooks = hooks.hooks;
      this.hookWarnings = hooks.warnings;
      this.hookErrors = hooks.errors;
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: hooks.status,
        operationId,
      });
    } catch (error) {
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not load hooks: ${errorMessage(error)}`,
        operationId,
      });
      new Notice("Could not load Codex hooks.");
    } finally {
      this.display();
    }
  }

  private async trustHook(hook: HookMetadata): Promise<void> {
    const operationId = this.nextSettingsDynamicOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.display();
    try {
      await this.withSettingsConnection((client) => client.trustHook(hook));
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: "Trusted hook definition.",
        operationId,
      });
      await this.loadHooks();
    } catch (error) {
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not trust hook: ${errorMessage(error)}`,
        operationId,
      });
      new Notice("Could not trust Codex hook.");
      this.display();
    }
  }

  private async setHookEnabled(hook: HookMetadata, enabled: boolean): Promise<void> {
    const operationId = this.nextSettingsDynamicOperationId();
    this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
      type: "started",
      status: "Loading hooks...",
      operationId,
    });
    this.display();
    try {
      await this.withSettingsConnection((client) => client.setHookEnabled(hook, enabled));
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "loaded",
        status: enabled ? "Enabled hook." : "Disabled hook.",
        operationId,
      });
      await this.loadHooks();
    } catch (error) {
      this.hooksLifecycle = transitionSettingsDynamicSectionLifecycle(this.hooksLifecycle, {
        type: "failed",
        status: `Could not update hook: ${errorMessage(error)}`,
        operationId,
      });
      new Notice("Could not update Codex hook.");
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
    const operationId = this.nextSettingsDynamicOperationId();
    this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
      type: "started",
      status: "Loading archived threads...",
      operationId,
    });
    this.display();
    try {
      const response = await this.withSettingsConnection((client) => client.unarchiveThread(threadId));
      this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "loaded",
        status: `Restored "${archivedThreadDisplayTitle(response.thread)}".`,
        operationId,
      });
      this.plugin.refreshSharedThreadListFromOpenSurface();
    } catch (error) {
      this.archivedThreadsLifecycle = transitionSettingsDynamicSectionLifecycle(this.archivedThreadsLifecycle, {
        type: "failed",
        status: `Could not restore archived thread: ${errorMessage(error)}`,
        operationId,
      });
      new Notice("Could not restore archived Codex thread.");
    } finally {
      this.display();
    }
  }

  private async withSettingsConnection<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    return withShortLivedAppServerClient(this.plugin.settings.codexPath, this.plugin.vaultPath, operation);
  }

  private nextSettingsDynamicOperationId(): number {
    this.settingsDynamicOperationId += 1;
    return this.settingsDynamicOperationId;
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

export interface CodexPanelSettingTabHost extends Plugin {
  settings: CodexPanelSettings;
  vaultPath: string;
  saveSettings(): Promise<void>;
  refreshSharedThreadListFromOpenSurface(): void;
  cachedModels(): Model[];
  publishModels(models: Model[]): void;
}
