import { type App, Notice, PluginSettingTab, Setting } from "obsidian";

import type { AppServerClient } from "./app-server/client";
import { withAppServerSession } from "./app-server/session-client";
import { DEFAULT_CODEX_PATH } from "./constants";
import type { ReasoningEffort } from "./generated/app-server/ReasoningEffort";
import type { HookMetadata } from "./generated/app-server/v2/HookMetadata";
import type { Model } from "./generated/app-server/v2/Model";
import type { Thread } from "./generated/app-server/v2/Thread";
import type CodexPanelPlugin from "./main";
import { findModelByIdOrName, REASONING_EFFORTS, sortedAvailableModels, supportedEffortsForModel } from "./panel/model-runtime";
import { loadHookData, loadSettingsData } from "./settings-data";
import { archivedThreadDisplayTitle, fullThreadTitle } from "./threads";
import { errorMessage, shortThreadId } from "./utils";

const CODEX_DEFAULT_VALUE = "__codex-default__";

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
  private namingModels: Model[] = [];
  private namingModelsLoading = false;
  private namingModelsStatus = "";

  constructor(
    app: App,
    private readonly plugin: CodexPanelPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("codex-panel-settings");

    const configSection = containerEl.createDiv({ cls: "codex-panel-settings__section codex-panel-settings__general-section" });
    new Setting(configSection)
      .setClass("codex-panel-settings__section-heading")
      .setHeading()
      .setName("General")
      .setDesc(
        "This plugin stores only panel metadata, the app-server launch command, and optional automatic thread naming runtime overrides. Sandbox, approvals, MCP, and normal chat runtime policy are resolved from Codex config for the current vault.",
      );

    new Setting(configSection)
      .setName("Settings data")
      .setDesc("Refresh thread naming models, hooks, and archived threads from Codex app-server.")
      .addButton((button) => {
        button
          .setButtonText(this.settingsDataLoading ? "Refreshing..." : "Refresh settings data")
          .setDisabled(this.settingsDataLoading)
          .onClick(() => void this.refreshSettingsData());
      });

    new Setting(configSection)
      .setName("Codex executable")
      .setDesc("Command used to launch `codex app-server`. Use an absolute path when Obsidian cannot see your shell PATH.")
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
      .setName("Thread naming model")
      .setDesc("Model and reasoning effort used only for automatic thread titles.")
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.threadNamingModel;
        const options = this.namingModelOptions();
        dropdown.selectEl.ariaLabel = "Thread naming model";
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
        const options = this.namingEffortOptions();
        dropdown.selectEl.ariaLabel = "Thread naming effort";
        dropdown.addOption(CODEX_DEFAULT_VALUE, "Codex default");
        for (const effort of options) {
          dropdown.addOption(effort, effort);
        }
        dropdown.setValue(current && options.includes(current) ? current : CODEX_DEFAULT_VALUE).onChange(async (value) => {
          this.plugin.settings.threadNamingEffort = value === CODEX_DEFAULT_VALUE ? null : (value as ReasoningEffort);
          await this.plugin.saveSettings();
        });
      });
    if (this.namingModelsLoading || (this.namingModelsStatus && !this.namingModelsStatus.startsWith("Loaded "))) {
      configSection.createEl("p", {
        cls: "setting-item-description codex-panel-settings__section-status",
        text: this.namingModelsStatus || "Loading models...",
      });
    }

    const hookSection = containerEl.createDiv({ cls: "codex-panel-settings__dynamic-section codex-panel-settings__hook-section" });
    new Setting(hookSection)
      .setClass("codex-panel-settings__dynamic-section-heading")
      .setHeading()
      .setName("Hook status")
      .setDesc("Review hooks discovered by Codex app-server for the current vault root, including trust and enabled state.");

    if (this.hooksLoading) {
      hookSection.createEl("p", { cls: "setting-item-description codex-panel-settings__dynamic-section-status", text: "Loading hooks..." });
    } else if (this.hooksLoaded) {
      this.renderHooks(hookSection);
    } else if (this.hooksStatus) {
      hookSection.createEl("p", { cls: "setting-item-description codex-panel-settings__dynamic-section-status", text: this.hooksStatus });
    }

    const archivedSection = containerEl.createDiv({
      cls: "codex-panel-settings__dynamic-section codex-panel-settings__archived-section",
    });
    new Setting(archivedSection)
      .setClass("codex-panel-settings__dynamic-section-heading")
      .setHeading()
      .setName("Archived thread list")
      .setDesc("Restore archived Codex threads to Chat History when they are needed again.");

    if (this.archivedThreadsLoading) {
      archivedSection.createEl("p", {
        cls: "setting-item-description codex-panel-settings__dynamic-section-status",
        text: "Loading archived threads...",
      });
    } else if (this.archivedThreadsLoaded && this.archivedThreads.length === 0) {
      archivedSection.createEl("p", {
        cls: "setting-item-description codex-panel-settings__dynamic-section-status",
        text: "No archived threads.",
      });
    } else if (this.archivedThreadsLoaded) {
      this.renderArchivedThreadList(archivedSection);
    } else if (this.archivedThreadsStatus) {
      archivedSection.createEl("p", {
        cls: "setting-item-description codex-panel-settings__dynamic-section-status",
        text: this.archivedThreadsStatus,
      });
    }

    this.maybeAutoLoadSettingsData();
  }

  private maybeAutoLoadSettingsData(): void {
    if (this.settingsDataAutoLoadStarted || this.settingsDataLoading) return;
    this.settingsDataAutoLoadStarted = true;
    void this.refreshSettingsData();
  }

  private async refreshSettingsData(): Promise<void> {
    this.settingsDataLoading = true;
    this.namingModelsLoading = true;
    this.archivedThreadsLoading = true;
    this.hooksLoading = true;
    this.namingModelsStatus = "Loading models...";
    this.archivedThreadsStatus = "Loading archived threads...";
    this.hooksStatus = "Loading hooks...";
    this.display();

    let failedCount = 0;
    try {
      const result = await this.withSettingsSession((client) => loadSettingsData(client, this.plugin.vaultPath));

      if (result.models.ok) {
        this.namingModels = result.models.data;
        this.namingModelsStatus = result.models.status;
      } else {
        failedCount += 1;
        this.namingModelsStatus = result.models.status;
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
      this.namingModelsStatus = `Could not load models: ${message}`;
      this.hooksStatus = `Could not load hooks: ${message}`;
      this.archivedThreadsStatus = `Could not load archived threads: ${message}`;
    } finally {
      this.settingsDataLoading = false;
      this.namingModelsLoading = false;
      this.archivedThreadsLoading = false;
      this.hooksLoading = false;
      if (failedCount > 0) {
        new Notice("Could not refresh all Codex settings data.");
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

  private async restoreArchivedThread(threadId: string): Promise<void> {
    this.archivedThreadsLoading = true;
    this.archivedThreadsStatus = "";
    this.display();
    try {
      const response = await this.withSettingsSession((client) => client.unarchiveThread(threadId));
      this.archivedThreads = this.archivedThreads.filter((thread) => thread.id !== threadId);
      this.archivedThreadsLoaded = true;
      this.archivedThreadsStatus = `Restored "${archivedThreadDisplayTitle(response.thread)}".`;
      this.plugin.refreshOpenThreadLists();
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

  private namingModelOptions(): Model[] {
    return sortedAvailableModels(this.namingModels);
  }

  private namingEffortOptions(): ReasoningEffort[] {
    const model = this.selectedNamingModel();
    return model ? supportedEffortsForModel(model) : REASONING_EFFORTS;
  }

  private namingEffortSupported(effort: ReasoningEffort | null): boolean {
    return !effort || this.namingEffortOptions().includes(effort);
  }

  private selectedNamingModel(): Model | null {
    return findModelByIdOrName(this.namingModels, this.plugin.settings.threadNamingModel);
  }

  private renderArchivedThreadList(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      cls: "setting-item-description codex-panel-settings__dynamic-list-summary",
      text: `Loaded ${this.archivedThreads.length} archived thread${this.archivedThreads.length === 1 ? "" : "s"} from Codex app-server.`,
    });
    const list = containerEl.createDiv({ cls: "setting-items codex-panel-settings__dynamic-list codex-panel-settings__archived-list" });
    for (const thread of this.archivedThreads) {
      const title = archivedThreadDisplayTitle(thread);
      const setting = new Setting(list)
        .setClass("codex-panel-settings__dynamic-row")
        .setName(title)
        .setDesc(`Updated ${formatThreadDate(thread.updatedAt)} · ${shortThreadId(thread.id)}`)
        .addExtraButton((button) => {
          button.setIcon("rotate-ccw").onClick(() => void this.restoreArchivedThread(thread.id));
          button.extraSettingsEl.addClass("codex-panel-settings__archived-restore");
          button.extraSettingsEl.setAttr("aria-label", `Restore ${title}`);
        });
      setting.settingEl.addClass("codex-panel-settings__archived-row");
      setting.settingEl.setAttr("title", fullThreadTitle(thread));
    }
  }

  private renderHooks(containerEl: HTMLElement): void {
    if (this.hooks.length === 0) {
      containerEl.createEl("p", { cls: "setting-item-description", text: "No hooks discovered for the current vault root." });
    } else {
      containerEl.createEl("p", {
        cls: "setting-item-description codex-panel-settings__dynamic-list-summary",
        text: `Loaded ${this.hooks.length} hook${this.hooks.length === 1 ? "" : "s"} from Codex app-server.`,
      });
      const list = containerEl.createDiv({ cls: "setting-items codex-panel-settings__dynamic-list codex-panel-settings__hook-list" });
      for (const hook of this.hooks) {
        this.renderHookRow(list, hook);
      }
    }

    for (const warning of this.hookWarnings) {
      containerEl.createEl("p", { cls: "setting-item-description codex-panel-settings__hook-warning", text: warning });
    }
    for (const error of this.hookErrors) {
      containerEl.createEl("p", { cls: "setting-item-description codex-panel-settings__hook-error", text: error });
    }
  }

  private renderHookRow(list: HTMLElement, hook: HookMetadata): void {
    const canTrust = !hook.isManaged && (hook.trustStatus === "untrusted" || hook.trustStatus === "modified");
    const setting = new Setting(list)
      .setClass("codex-panel-settings__dynamic-row")
      .setName(hook.statusMessage || hook.command || hook.matcher || hook.eventName)
      .setDesc(`${hook.eventName} · ${hook.matcher ?? "(no matcher)"} · ${hook.trustStatus} · ${hook.enabled ? "enabled" : "disabled"}`)
      .addButton((button) => {
        button
          .setButtonText("Trust")
          .setDisabled(this.hooksLoading || !canTrust)
          .onClick(() => void this.trustHook(hook));
      })
      .addButton((button) => {
        button
          .setButtonText(hook.enabled ? "Disable" : "Enable")
          .setDisabled(this.hooksLoading || hook.isManaged)
          .onClick(() => void this.setHookEnabled(hook, !hook.enabled));
      });
    setting.settingEl.addClass("codex-panel-settings__hook-row");
    setting.settingEl.setAttr("title", hook.command ?? hook.key);
    setting.descEl.createDiv({
      cls: "codex-panel-settings__hook-hash",
      text: hook.currentHash,
      attr: { title: hook.key },
    });
  }
}

function formatThreadDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
