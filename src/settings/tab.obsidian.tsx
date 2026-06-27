import { type App, Notice, type Plugin, PluginSettingTab } from "obsidian";

import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../domain/catalog/metadata";
import { listenDomEvent } from "../shared/ui/dom-events.dom";
import { renderUiRoot, unmountUiRoot } from "../shared/ui/ui-root.dom";
import { SettingsDynamicSectionsController } from "./dynamic-sections-controller";
import type { CodexPanelSettingTabHost } from "./host";
import type { SettingsSectionsState } from "./section-state";
import { SettingsTabShell } from "./tab-shell";

const SETTINGS_INTRO_TEXT = "Codex Panel stores panel preferences only. Runtime settings still come from Codex.";

export class CodexPanelSettingTab extends PluginSettingTab {
  private readonly dynamicSections: SettingsDynamicSectionsController;
  private archivedDeleteConfirmThreadId: string | null = null;
  private disposeOutsidePointer: (() => void) | null = null;
  private readonly cancelArchivedDeleteConfirmOnOutsidePointer = (event: PointerEvent): void => {
    if (!this.archivedDeleteConfirmThreadId) return;
    const target = event.target;
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    if (viewWindow && target instanceof viewWindow.Element) {
      const deleteConfirm = target.closest(".codex-panel-settings__archived-row--delete-confirming");
      if (deleteConfirm && this.containerEl.contains(deleteConfirm)) return;
    }
    this.archivedDeleteConfirmThreadId = null;
    this.renderSettingsShell();
  };

  constructor(
    app: App,
    owner: Plugin,
    private readonly plugin: CodexPanelSettingTabHost,
  ) {
    super(app, owner);
    this.dynamicSections = new SettingsDynamicSectionsController(plugin, {
      display: () => {
        this.renderSettingsShell();
      },
      notify: (message) => {
        new Notice(message);
      },
    });
  }

  display(): void {
    this.dynamicSections.activate();
    this.renderSettingsTab({ autoLoadDynamicSections: true });
  }

  override hide(): void {
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = null;
    this.archivedDeleteConfirmThreadId = null;
    this.dynamicSections.dispose();
    unmountUiRoot(this.containerEl);
    super.hide();
  }

  private renderSettingsTab(options: { autoLoadDynamicSections: boolean }): void {
    const { containerEl } = this;
    containerEl.addClass("codex-panel-settings");
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = listenDomEvent(containerEl, "pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);

    this.renderSettingsShell();

    if (options.autoLoadDynamicSections) this.maybeAutoLoadDynamicSections();
  }

  private renderSettingsShell(): void {
    renderUiRoot(
      this.containerEl,
      <SettingsTabShell
        introText={SETTINGS_INTRO_TEXT}
        dynamicSectionsLoading={this.dynamicSections.isLoading()}
        panel={{
          codexPath: this.plugin.settings.codexPath,
          showToolbar: this.plugin.settings.showToolbar,
          sendShortcut: this.plugin.settings.sendShortcut,
          scrollThreadFromComposerEdges: this.plugin.settings.scrollThreadFromComposerEdges,
        }}
        sections={this.settingsSectionsState()}
        actions={{
          refreshDynamicSections: () => {
            void this.dynamicSections.refreshDynamicSections();
          },
          setCodexPath: (value) => {
            void this.setCodexPath(value);
          },
          setShowToolbar: (value) => {
            void this.setShowToolbar(value);
          },
          setSendShortcut: (value) => {
            void this.setSendShortcut(value);
          },
          setScrollThreadFromComposerEdges: (value) => {
            void this.setScrollThreadFromComposerEdges(value);
          },
        }}
      />,
    );
  }

  private settingsSectionsState(): SettingsSectionsState {
    const dynamicSections = this.dynamicSections.snapshot();
    return {
      helper: {
        threadNamingModel: this.plugin.settings.threadNamingModel,
        threadNamingEffort: this.plugin.settings.threadNamingEffort,
        rewriteSelectionModel: this.plugin.settings.rewriteSelectionModel,
        rewriteSelectionEffort: this.plugin.settings.rewriteSelectionEffort,
        models: this.dynamicSections.modelMetadata(),
        modelLoadFailed: dynamicSections.modelsLifecycle.kind === "failed",
        modelStatus: dynamicSections.modelsLifecycle.status,
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
        threads: dynamicSections.archivedThreads,
        contentAvailable:
          dynamicSections.archivedThreadsLifecycle.kind === "loaded" ||
          (dynamicSections.archivedThreadsLifecycle.kind === "loading" && dynamicSections.archivedThreadsLoaded),
        loaded: dynamicSections.archivedThreadsLifecycle.kind === "loaded",
        loading: dynamicSections.archivedThreadsLifecycle.kind === "loading",
        status: dynamicSections.archivedThreadsLifecycle.status,
        deleteConfirmThreadId: this.archivedDeleteConfirmThreadId,
        onExportEnabledChange: (enabled) => void this.setArchiveExportEnabled(enabled),
        onExportFolderTemplateChange: (value) => void this.setArchiveExportFolderTemplate(value),
        onExportFilenameTemplateChange: (value) => void this.setArchiveExportFilenameTemplate(value),
        onExportTagsChange: (value) => void this.setArchiveExportTags(value),
        onRestore: (threadId) => {
          this.archivedDeleteConfirmThreadId = null;
          this.renderSettingsShell();
          void this.dynamicSections.restoreArchivedThread(threadId);
        },
        onStartDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = threadId;
          this.renderSettingsShell();
        },
        onDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = null;
          this.renderSettingsShell();
          void this.dynamicSections.deleteArchivedThread(threadId);
        },
      },
      hooks: {
        hooks: dynamicSections.hooks,
        warnings: dynamicSections.hookWarnings,
        errors: dynamicSections.hookErrors,
        contentAvailable:
          dynamicSections.hooksLifecycle.kind === "loaded" ||
          (dynamicSections.hooksLifecycle.kind === "loading" && dynamicSections.hooksLoaded),
        loaded: dynamicSections.hooksLifecycle.kind === "loaded",
        loading: dynamicSections.hooksLifecycle.kind === "loading",
        status: dynamicSections.hooksLifecycle.status,
        onTrust: (hook) => void this.dynamicSections.trustHook(hook),
        onToggleEnabled: (hook, enabled) => void this.dynamicSections.setHookEnabled(hook, enabled),
      },
    };
  }

  private maybeAutoLoadDynamicSections(): void {
    this.dynamicSections.maybeAutoLoadDynamicSections();
  }

  private async setCodexPath(value: string): Promise<void> {
    const codexPath = value.trim() || DEFAULT_CODEX_PATH;
    if (codexPath === this.plugin.settings.codexPath) return;
    this.plugin.settings.codexPath = codexPath;
    await this.plugin.saveSettings();
    this.dynamicSections.resetDynamicSectionContext();
    this.plugin.appServerQueries.notifyContextChanged();
    this.plugin.refreshOpenViews();
    this.renderSettingsShell();
  }

  private async setShowToolbar(value: boolean): Promise<void> {
    this.plugin.settings.showToolbar = value;
    await this.plugin.saveSettings();
    this.plugin.refreshOpenViews();
    this.renderSettingsShell();
  }

  private async setSendShortcut(value: "enter" | "mod-enter"): Promise<void> {
    this.plugin.settings.sendShortcut = value;
    await this.plugin.saveSettings();
    this.renderSettingsShell();
  }

  private async setScrollThreadFromComposerEdges(value: boolean): Promise<void> {
    this.plugin.settings.scrollThreadFromComposerEdges = value;
    await this.plugin.saveSettings();
    this.renderSettingsShell();
  }

  private async setArchiveExportEnabled(enabled: boolean): Promise<void> {
    this.plugin.settings.archiveExportEnabled = enabled;
    await this.plugin.saveSettings();
    this.renderSettingsShell();
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
    if (!this.dynamicSections.namingEffortSupported(this.plugin.settings.threadNamingEffort)) {
      this.plugin.settings.threadNamingEffort = null;
    }
    await this.plugin.saveSettings();
    this.renderSettingsShell();
  }

  private async setThreadNamingEffort(value: ReasoningEffort | null): Promise<void> {
    this.plugin.settings.threadNamingEffort = value;
    await this.plugin.saveSettings();
  }

  private async setRewriteSelectionModel(value: string | null): Promise<void> {
    this.plugin.settings.rewriteSelectionModel = value;
    if (!this.dynamicSections.rewriteSelectionEffortSupported(this.plugin.settings.rewriteSelectionEffort)) {
      this.plugin.settings.rewriteSelectionEffort = null;
    }
    await this.plugin.saveSettings();
    this.renderSettingsShell();
  }

  private async setRewriteSelectionEffort(value: ReasoningEffort | null): Promise<void> {
    this.plugin.settings.rewriteSelectionEffort = value;
    await this.plugin.saveSettings();
  }
}
