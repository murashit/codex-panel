import { type App, Notice, type Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";

import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../domain/catalog/metadata";
import { renderUiRoot, unmountUiRoot } from "../shared/ui/ui-root";
import { ArchivedThreadSection } from "./archived-section";
import { SettingsDynamicDataController, type SettingsDynamicDataDisplayTarget } from "./dynamic-data-controller";
import { HelperSettingsSection } from "./helper-section";
import type { CodexPanelSettingTabHost } from "./host";
import { HookSection } from "./hook-section";
import type { SettingsSectionsState } from "./section-state";

const SETTINGS_INTRO_TEXT =
  "Codex Panel stores only panel preferences. Models, sandboxing, approvals, MCP servers, hooks, and network access still come from Codex config.";
const SEND_SHORTCUT_LABELS = {
  enter: "Enter",
  "mod-enter": "Cmd/Ctrl+Enter",
} as const;

interface DynamicSectionRoots {
  container: HTMLElement;
  helper: HTMLElement;
  archived: HTMLElement;
  hooks: HTMLElement;
}

function renderSettingsHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl).setClass("codex-panel-settings__section-heading").setHeading().setName(name);
}

function createSettingsGroup(containerEl: HTMLElement, className: string): HTMLElement {
  return containerEl.createDiv({ cls: `setting-group ${className}` });
}

function createSettingsItems(containerEl: HTMLElement): HTMLElement {
  return containerEl.createDiv({ cls: "setting-items" });
}

export class CodexPanelSettingTab extends PluginSettingTab {
  private readonly dynamicData: SettingsDynamicDataController;
  private archivedDeleteConfirmThreadId: string | null = null;
  private dynamicSectionRoots: DynamicSectionRoots | null = null;
  private readonly cancelArchivedDeleteConfirmOnOutsidePointer = (event: PointerEvent): void => {
    if (!this.archivedDeleteConfirmThreadId) return;
    const target = event.target;
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    if (viewWindow && target instanceof viewWindow.Element) {
      const deleteConfirm = target.closest(".codex-panel-settings__archived-row--delete-confirming");
      if (deleteConfirm && this.containerEl.contains(deleteConfirm)) return;
    }
    this.archivedDeleteConfirmThreadId = null;
    this.renderDynamicSections("archived");
  };

  constructor(
    app: App,
    owner: Plugin,
    private readonly plugin: CodexPanelSettingTabHost,
  ) {
    super(app, owner);
    this.dynamicData = new SettingsDynamicDataController(plugin, {
      display: (target) => {
        this.renderDynamicSections(target);
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
    this.containerEl.removeEventListener("pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);
    this.archivedDeleteConfirmThreadId = null;
    this.dynamicData.dispose();
    this.unmountDynamicSectionRoots();
    super.hide();
  }

  private renderSettingsTab(options: { autoLoadCodexData: boolean }): void {
    const { containerEl } = this;
    this.unmountDynamicSectionRoots();
    containerEl.empty();
    containerEl.addClass("codex-panel-settings");
    containerEl.removeEventListener("pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);
    containerEl.addEventListener("pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);

    this.renderHeaderActions(containerEl, SETTINGS_INTRO_TEXT);
    this.renderPanelPreferenceSections(containerEl);
    this.createDynamicSectionRoots(containerEl);
    this.renderDynamicSections("all");

    if (options.autoLoadCodexData) this.maybeAutoLoadSettingsData();
  }

  private renderPanelPreferenceSections(containerEl: HTMLElement): void {
    const configSection = createSettingsGroup(containerEl, "codex-panel-settings__section codex-panel-settings__general-section");
    const configItems = createSettingsItems(configSection);

    new Setting(configItems)
      .setName("Codex executable")
      .setDesc("Path used to start `codex app-server`. Use an absolute path if Obsidian cannot find `codex`.")
      .addText((text) => {
        text.setPlaceholder(DEFAULT_CODEX_PATH).setValue(this.plugin.settings.codexPath);
        const commitCodexPath = () => {
          void this.setCodexPath(text.inputEl.value);
        };
        text.inputEl.addEventListener("blur", commitCodexPath);
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitCodexPath();
          text.inputEl.blur();
        });
      });
    new Setting(configItems)
      .setName("Show chat toolbar")
      .setDesc("Show the chat panel toolbar. Slash commands, composer status controls, and the threads view remain available when hidden.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showToolbar).onChange(async (value) => {
          this.plugin.settings.showToolbar = value;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        });
      });

    const composerSection = createSettingsGroup(containerEl, "codex-panel-settings__section codex-panel-settings__composer-section");
    renderSettingsHeading(composerSection, "Composer");
    const composerItems = createSettingsItems(composerSection);
    new Setting(composerItems)
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
    new Setting(composerItems)
      .setName("Scroll thread from composer edges")
      .setDesc("When enabled, Up/Ctrl+P on the first composer line and Down/Ctrl+N on the last line scroll the thread.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.scrollThreadFromComposerEdges).onChange(async (value) => {
          this.plugin.settings.scrollThreadFromComposerEdges = value;
          await this.plugin.saveSettings();
        });
      });
  }

  private createDynamicSectionRoots(containerEl: HTMLElement): void {
    const container = containerEl.createDiv({ cls: "codex-panel-settings__preact-sections" });
    this.dynamicSectionRoots = {
      container,
      helper: container.createDiv(),
      archived: container.createDiv(),
      hooks: container.createDiv(),
    };
  }

  private unmountDynamicSectionRoots(): void {
    const roots = this.dynamicSectionRoots;
    if (!roots) return;
    unmountUiRoot(roots.helper);
    unmountUiRoot(roots.archived);
    unmountUiRoot(roots.hooks);
    this.dynamicSectionRoots = null;
  }

  private renderDynamicSections(target: SettingsDynamicDataDisplayTarget): void {
    const roots = this.dynamicSectionRoots;
    if (!roots) return;
    const state = this.dynamicSectionsState();
    if (target === "all" || target === "helper") {
      renderUiRoot(roots.helper, <HelperSettingsSection state={state.helper} />);
    }
    if (target === "all" || target === "archived") {
      renderUiRoot(roots.archived, <ArchivedThreadSection state={state.archived} />);
    }
    if (target === "all" || target === "hooks") {
      renderUiRoot(roots.hooks, <HookSection state={state.hooks} />);
    }
  }

  private dynamicSectionsState(): SettingsSectionsState {
    const dynamicData = this.dynamicData.snapshot();
    return {
      helper: {
        threadNamingModel: this.plugin.settings.threadNamingModel,
        threadNamingEffort: this.plugin.settings.threadNamingEffort,
        rewriteSelectionModel: this.plugin.settings.rewriteSelectionModel,
        rewriteSelectionEffort: this.plugin.settings.rewriteSelectionEffort,
        models: this.dynamicData.modelMetadata(),
        modelLoadFailed: dynamicData.modelsLifecycle.kind === "failed",
        modelStatus: dynamicData.modelsLifecycle.status,
        onThreadNamingModelChange: (value) => void this.setThreadNamingModel(value),
        onThreadNamingEffortChange: (value) => void this.setThreadNamingEffort(value),
        onRewriteSelectionModelChange: (value) => void this.setRewriteSelectionModel(value),
        onRewriteSelectionEffortChange: (value) => void this.setRewriteSelectionEffort(value),
      },
      archived: {
        exportEnabled: this.plugin.settings.archiveExportEnabled,
        exportFolderTemplate: this.plugin.settings.archiveExportFolderTemplate,
        exportFilenameTemplate: this.plugin.settings.archiveExportFilenameTemplate,
        exportTags: this.plugin.settings.archiveExportTags,
        threads: dynamicData.archivedThreads,
        contentAvailable:
          dynamicData.archivedThreadsLifecycle.kind === "loaded" ||
          (dynamicData.archivedThreadsLifecycle.kind === "loading" && dynamicData.archivedThreadsLoaded),
        loaded: dynamicData.archivedThreadsLifecycle.kind === "loaded",
        loading: dynamicData.archivedThreadsLifecycle.kind === "loading",
        status: dynamicData.archivedThreadsLifecycle.status,
        deleteConfirmThreadId: this.archivedDeleteConfirmThreadId,
        onExportEnabledChange: (enabled) => void this.setArchiveExportEnabled(enabled),
        onExportFolderTemplateChange: (value) => void this.setArchiveExportFolderTemplate(value),
        onExportFilenameTemplateChange: (value) => void this.setArchiveExportFilenameTemplate(value),
        onExportTagsChange: (value) => void this.setArchiveExportTags(value),
        onRestore: (threadId) => {
          this.archivedDeleteConfirmThreadId = null;
          this.renderDynamicSections("archived");
          void this.dynamicData.restoreArchivedThread(threadId);
        },
        onStartDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = threadId;
          this.renderDynamicSections("archived");
        },
        onDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = null;
          this.renderDynamicSections("archived");
          void this.dynamicData.deleteArchivedThread(threadId);
        },
      },
      hooks: {
        hooks: dynamicData.hooks,
        warnings: dynamicData.hookWarnings,
        errors: dynamicData.hookErrors,
        contentAvailable:
          dynamicData.hooksLifecycle.kind === "loaded" || (dynamicData.hooksLifecycle.kind === "loading" && dynamicData.hooksLoaded),
        loaded: dynamicData.hooksLifecycle.kind === "loaded",
        loading: dynamicData.hooksLifecycle.kind === "loading",
        status: dynamicData.hooksLifecycle.status,
        onTrust: (hook) => void this.dynamicData.trustHook(hook),
        onToggleEnabled: (hook, enabled) => void this.dynamicData.setHookEnabled(hook, enabled),
      },
    };
  }

  private renderHeaderActions(containerEl: HTMLElement, introText: string): void {
    const header = containerEl.createDiv({ cls: "setting-item setting-item-heading codex-panel-settings__header" });
    const info = header.createDiv({ cls: "setting-item-info" });
    info.createDiv({
      cls: "setting-item-description codex-panel-settings__section-intro",
      text: introText,
    });
    const control = header.createDiv({ cls: "setting-item-control" });
    const button = control.createEl("button", {
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

  private async setCodexPath(value: string): Promise<void> {
    const codexPath = value.trim() || DEFAULT_CODEX_PATH;
    if (codexPath === this.plugin.settings.codexPath) return;
    this.plugin.settings.codexPath = codexPath;
    await this.plugin.saveSettings();
    this.dynamicData.resetSettingsDataContext();
    this.plugin.appServerData.notifyContextChanged();
    this.plugin.refreshOpenViews();
    this.renderSettingsTab({ autoLoadCodexData: false });
  }

  private async setArchiveExportEnabled(enabled: boolean): Promise<void> {
    this.plugin.settings.archiveExportEnabled = enabled;
    await this.plugin.saveSettings();
    this.renderDynamicSections("archived");
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

  private async setThreadNamingModel(value: string | null): Promise<void> {
    this.plugin.settings.threadNamingModel = value;
    if (!this.dynamicData.namingEffortSupported(this.plugin.settings.threadNamingEffort)) {
      this.plugin.settings.threadNamingEffort = null;
    }
    await this.plugin.saveSettings();
    this.renderDynamicSections("helper");
  }

  private async setThreadNamingEffort(value: ReasoningEffort | null): Promise<void> {
    this.plugin.settings.threadNamingEffort = value;
    await this.plugin.saveSettings();
  }

  private async setRewriteSelectionModel(value: string | null): Promise<void> {
    this.plugin.settings.rewriteSelectionModel = value;
    if (!this.dynamicData.rewriteSelectionEffortSupported(this.plugin.settings.rewriteSelectionEffort)) {
      this.plugin.settings.rewriteSelectionEffort = null;
    }
    await this.plugin.saveSettings();
    this.renderDynamicSections("helper");
  }

  private async setRewriteSelectionEffort(value: ReasoningEffort | null): Promise<void> {
    this.plugin.settings.rewriteSelectionEffort = value;
    await this.plugin.saveSettings();
  }
}
