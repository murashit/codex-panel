import { type App, Notice, type Plugin, PluginSettingTab } from "obsidian";

import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../domain/catalog/metadata";
import { listenDomEvent } from "../shared/dom/events.dom";
import { renderUiRoot, unmountUiRoot } from "../shared/dom/preact-root.dom";
import { SettingsDynamicSectionsController } from "./dynamic-sections-controller";
import type { CodexPanelSettingTabHost } from "./host";
import type { CodexPanelSettings } from "./model";
import { DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE, DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE, DEFAULT_ATTACHMENT_FOLDER } from "./model";
import type { SettingsSectionsState } from "./section-state";
import { SettingsTabShell } from "./tab-shell";

const SETTINGS_INTRO_TEXT = "Codex Panel stores panel preferences only. Runtime settings still come from Codex.";

export class CodexPanelSettingTab extends PluginSettingTab {
  private readonly dynamicSections: SettingsDynamicSectionsController;
  private displayed = false;
  private settingsShellRevision = 0;
  private settingsMutationQueue: Promise<void> = Promise.resolve();
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
    this.requestRender();
  };

  constructor(
    app: App,
    owner: Plugin,
    private readonly plugin: CodexPanelSettingTabHost,
  ) {
    super(app, owner);
    this.dynamicSections = new SettingsDynamicSectionsController(plugin, {
      display: () => {
        this.requestRender();
      },
      notify: (message) => {
        new Notice(message);
      },
    });
  }

  display(): void {
    this.displayed = true;
    this.dynamicSections.activate();
    this.renderSettingsTab({ autoLoadDynamicSections: true });
  }

  override hide(): void {
    this.displayed = false;
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
        key={this.settingsShellRevision}
        introText={SETTINGS_INTRO_TEXT}
        dynamicSectionsLoading={this.dynamicSections.isLoading()}
        panel={{
          codexPath: this.plugin.settings.codexPath,
          showToolbar: this.plugin.settings.showToolbar,
          sendShortcut: this.plugin.settings.sendShortcut,
          scrollThreadFromComposerEdges: this.plugin.settings.scrollThreadFromComposerEdges,
          referenceActiveNoteOnSend: this.plugin.settings.referenceActiveNoteOnSend,
          attachmentFolder: this.plugin.settings.attachmentFolder,
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
          setReferenceActiveNoteOnSend: (value) => {
            void this.setReferenceActiveNoteOnSend(value);
          },
          setAttachmentFolder: (value) => {
            void this.setAttachmentFolder(value);
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
          this.requestRender();
          void this.dynamicSections.restoreArchivedThread(threadId);
        },
        onStartDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = threadId;
          this.requestRender();
        },
        onDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = null;
          this.requestRender();
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

  private setCodexPath(value: string): Promise<void> {
    const codexPath = value.trim() || DEFAULT_CODEX_PATH;
    return this.queueSettingsMutation(
      (settings) => {
        if (codexPath === settings.codexPath) return false;
        settings.codexPath = codexPath;
        return true;
      },
      {
        onPublished: ({ appServerContextReplaced }) => {
          if (appServerContextReplaced) this.dynamicSections.resetDynamicSectionContext();
        },
      },
    );
  }

  private setShowToolbar(value: boolean): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.showToolbar = value;
    });
  }

  private setSendShortcut(value: "enter" | "mod-enter"): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.sendShortcut = value;
    });
  }

  private setScrollThreadFromComposerEdges(value: boolean): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.scrollThreadFromComposerEdges = value;
    });
  }

  private setReferenceActiveNoteOnSend(value: boolean): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.referenceActiveNoteOnSend = value;
    });
  }

  private setAttachmentFolder(value: string): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.attachmentFolder = value.trim() || DEFAULT_ATTACHMENT_FOLDER;
    });
  }

  private setArchiveExportEnabled(enabled: boolean): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportEnabled = enabled;
    });
  }

  private setArchiveExportFolderTemplate(value: string): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportFolderTemplate = value.trim() || DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE;
    });
  }

  private setArchiveExportFilenameTemplate(value: string): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportFilenameTemplate = value.trim() || DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE;
    });
  }

  private setArchiveExportTags(value: string): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportTags = value.trim();
    });
  }

  private setThreadNamingModel(value: string | null): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.threadNamingModel = value;
      if (!this.dynamicSections.namingEffortSupported(settings.threadNamingEffort)) {
        settings.threadNamingEffort = null;
      }
    });
  }

  private setThreadNamingEffort(value: ReasoningEffort | null): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.threadNamingEffort = value;
    });
  }

  private setRewriteSelectionModel(value: string | null): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.rewriteSelectionModel = value;
      if (!this.dynamicSections.rewriteSelectionEffortSupported(settings.rewriteSelectionEffort)) {
        settings.rewriteSelectionEffort = null;
      }
    });
  }

  private setRewriteSelectionEffort(value: ReasoningEffort | null): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.rewriteSelectionEffort = value;
    });
  }

  private queueSettingsMutation(
    mutate: (settings: CodexPanelSettings) => boolean | undefined,
    publication: { onPublished?: (result: { appServerContextReplaced: boolean }) => void } = {},
  ): Promise<void> {
    const operation = this.settingsMutationQueue.then(async () => {
      const candidateSettings: CodexPanelSettings = { ...this.plugin.settings };
      if (mutate(candidateSettings) === false) return;
      try {
        const result = await this.plugin.publishSettings(candidateSettings);
        publication.onPublished?.(result);
      } catch (error) {
        this.settingsShellRevision += 1;
        new Notice(`Failed to save Codex Panel settings: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    });
    const settledOperation = operation.catch(() => undefined);
    this.settingsMutationQueue = settledOperation;
    void settledOperation.then(() => {
      if (this.settingsMutationQueue === settledOperation) this.requestRender();
    });
    return operation;
  }

  private requestRender(): void {
    if (this.displayed) this.renderSettingsShell();
  }
}
