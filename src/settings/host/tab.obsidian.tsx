import { type App, Notice, type Plugin, PluginSettingTab, type Setting } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import type { ReasoningEffort } from "../../domain/catalog/metadata";
import { listenDomEvent } from "../../shared/dom/events.dom";
import { unmountUiRoot } from "../../shared/dom/preact-root.dom";
import { renderObsidianUiRoot } from "../../shared/obsidian/preact-root.obsidian";
import { IconButton } from "../../shared/ui/icon.dom";
import { SettingsResourcesController } from "../application/resources-controller";
import {
  type CodexPanelSettings,
  normalizeArchiveExportFilenameTemplate,
  normalizeArchiveExportFolderTemplate,
  normalizeArchiveExportTags,
  normalizeAttachmentFolder,
  normalizeCodexPath,
} from "../preferences";
import { ArchivedThreadsContent } from "../ui/archived-threads";
import { CodexHooksContent } from "../ui/codex-hooks";
import { ObsidianCommitTextInput } from "../ui/controls.obsidian";
import {
  ACTIVE_FILE_REFERENCE_SETTING,
  ARCHIVE_EXPORT_ENABLED_SETTING,
  ARCHIVE_EXPORT_FILENAME_SETTING,
  ARCHIVE_EXPORT_FOLDER_SETTING,
  ARCHIVE_EXPORT_TAGS_SETTING,
  ATTACHMENT_FOLDER_SETTING,
  CODEX_EXECUTABLE_SETTING,
  COMPOSER_SCROLL_SETTING,
  SELECTION_REWRITE_SETTING,
  SEND_SHORTCUT_LABELS,
  SEND_SHORTCUT_SETTING,
  SETTINGS_INTRO_TEXT,
  SHOW_TOOLBAR_SETTING,
  THREAD_NAMING_SETTING,
} from "../ui/definitions";
import { LegacySettingsView } from "../ui/legacy-view";
import { ModelEffortControl } from "../ui/panel-helpers";
import type { SettingsViewModel } from "../ui/view-model";
import type { SettingsTabHost } from "./contracts";
import type { DeclarativeSettingDefinition, DeclarativeSettingDefinitionItem } from "./declarative-api.compat";

export class CodexPanelSettingTab extends PluginSettingTab {
  private readonly resources: SettingsResourcesController;
  private renderMode: "hidden" | "legacy" | "declarative" = "hidden";
  private renderRevision = 0;
  private settingsMutationQueue: Promise<void> = Promise.resolve();
  private archivedDeleteConfirmThreadId: string | null = null;
  private disposeOutsidePointer: (() => void) | null = null;
  private readonly declarativeIslandRefreshers = new Set<() => void>();
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
    private readonly plugin: SettingsTabHost,
  ) {
    super(app, owner);
    this.resources = new SettingsResourcesController(plugin.resources, {
      display: () => {
        this.requestRender();
      },
      notify: (message) => {
        new Notice(message);
      },
    });
  }

  display(): void {
    this.renderMode = "legacy";
    this.resources.activate();
    this.renderSettingsTab({ autoLoadResources: true });
  }

  // Obsidian 1.13+ discovers this method at runtime and skips display(). The
  // local return type mirrors the 1.13 API while the project retains 1.12 types.
  getSettingDefinitions(): DeclarativeSettingDefinitionItem[] {
    return [
      {
        name: "Codex details",
        desc: SETTINGS_INTRO_TEXT,
        searchable: false,
        render: (setting) =>
          this.renderDeclarativeControl(setting, () => (
            <IconButton
              icon="refresh-cw"
              label={this.resources.canRefresh() ? "Refresh Codex details" : "Refreshing Codex details"}
              className="clickable-icon codex-panel-settings__refresh-button"
              disabled={!this.resources.canRefresh()}
              onClick={() => void this.resources.refresh()}
            />
          )),
      },
      {
        name: CODEX_EXECUTABLE_SETTING.name,
        desc: CODEX_EXECUTABLE_SETTING.desc,
        render: (setting) =>
          this.renderDeclarativeControl(setting, () => (
            <ObsidianCommitTextInput
              key={this.renderRevision}
              value={this.plugin.settings.codexPath}
              placeholder={CODEX_EXECUTABLE_SETTING.placeholder}
              normalizeValue={normalizeCodexPath}
              onCommit={(value) => void this.setCodexPath(value)}
            />
          )),
      },
      {
        name: SHOW_TOOLBAR_SETTING.name,
        desc: SHOW_TOOLBAR_SETTING.desc,
        control: { type: "toggle", key: "showToolbar" },
      },
      {
        type: "group",
        heading: "Panel helpers",
        cls: "codex-panel-settings__section",
        items: [
          {
            name: THREAD_NAMING_SETTING.name,
            desc: THREAD_NAMING_SETTING.desc,
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => {
                const helper = this.settingsViewModel().helper;
                return (
                  <ModelEffortControl
                    name={THREAD_NAMING_SETTING.name}
                    desc={THREAD_NAMING_SETTING.desc}
                    modelValue={helper.threadNamingModel}
                    effortValue={helper.threadNamingEffort}
                    models={helper.models}
                    onModelChange={helper.onThreadNamingModelChange}
                    onEffortChange={helper.onThreadNamingEffortChange}
                    controlsOnly
                  />
                );
              }),
          },
          {
            name: SELECTION_REWRITE_SETTING.name,
            desc: SELECTION_REWRITE_SETTING.desc,
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => {
                const helper = this.settingsViewModel().helper;
                setting.setDesc(
                  helper.modelError ? `${SELECTION_REWRITE_SETTING.desc} ${helper.modelError}` : SELECTION_REWRITE_SETTING.desc,
                );
                return (
                  <ModelEffortControl
                    name={SELECTION_REWRITE_SETTING.name}
                    desc={SELECTION_REWRITE_SETTING.desc}
                    modelValue={helper.rewriteSelectionModel}
                    effortValue={helper.rewriteSelectionEffort}
                    models={helper.models}
                    onModelChange={helper.onRewriteSelectionModelChange}
                    onEffortChange={helper.onRewriteSelectionEffortChange}
                    controlsOnly
                  />
                );
              }),
          },
        ],
      },
      {
        type: "group",
        heading: "Composer",
        cls: "codex-panel-settings__section",
        items: [
          {
            name: SEND_SHORTCUT_SETTING.name,
            desc: SEND_SHORTCUT_SETTING.desc,
            control: {
              type: "dropdown",
              key: "sendShortcut",
              defaultValue: "enter",
              options: SEND_SHORTCUT_LABELS,
            },
          },
          {
            name: COMPOSER_SCROLL_SETTING.name,
            desc: COMPOSER_SCROLL_SETTING.desc,
            control: { type: "toggle", key: "scrollThreadFromComposerEdges" },
          },
          {
            name: ACTIVE_FILE_REFERENCE_SETTING.name,
            desc: ACTIVE_FILE_REFERENCE_SETTING.desc,
            control: { type: "toggle", key: "referenceActiveNoteOnSend" },
          },
          {
            name: ATTACHMENT_FOLDER_SETTING.name,
            desc: ATTACHMENT_FOLDER_SETTING.desc,
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => (
                <ObsidianCommitTextInput
                  key={this.renderRevision}
                  value={this.plugin.settings.attachmentFolder}
                  placeholder={ATTACHMENT_FOLDER_SETTING.placeholder}
                  normalizeValue={normalizeAttachmentFolder}
                  onCommit={(value) => void this.setAttachmentFolder(value)}
                />
              )),
          },
        ],
      },
      {
        type: "group",
        heading: "Thread archiving",
        cls: "codex-panel-settings__dynamic-section",
        items: [
          {
            name: ARCHIVE_EXPORT_ENABLED_SETTING.name,
            desc: ARCHIVE_EXPORT_ENABLED_SETTING.desc,
            control: { type: "toggle", key: "archiveExportEnabled" },
          },
          this.commitTextDefinition({
            name: ARCHIVE_EXPORT_FOLDER_SETTING.name,
            desc: ARCHIVE_EXPORT_FOLDER_SETTING.desc,
            value: () => this.plugin.settings.archiveExportFolderTemplate,
            placeholder: ARCHIVE_EXPORT_FOLDER_SETTING.placeholder,
            normalizeValue: normalizeArchiveExportFolderTemplate,
            onCommit: (value) => this.setArchiveExportFolderTemplate(value),
          }),
          this.commitTextDefinition({
            name: ARCHIVE_EXPORT_FILENAME_SETTING.name,
            desc: ARCHIVE_EXPORT_FILENAME_SETTING.desc,
            value: () => this.plugin.settings.archiveExportFilenameTemplate,
            placeholder: ARCHIVE_EXPORT_FILENAME_SETTING.placeholder,
            normalizeValue: normalizeArchiveExportFilenameTemplate,
            onCommit: (value) => this.setArchiveExportFilenameTemplate(value),
          }),
          this.commitTextDefinition({
            name: ARCHIVE_EXPORT_TAGS_SETTING.name,
            desc: ARCHIVE_EXPORT_TAGS_SETTING.desc,
            value: () => this.plugin.settings.archiveExportTags,
            placeholder: ARCHIVE_EXPORT_TAGS_SETTING.placeholder,
            normalizeValue: normalizeArchiveExportTags,
            onCommit: (value) => this.setArchiveExportTags(value),
          }),
        ],
      },
      {
        type: "group",
        heading: "Archived threads",
        cls: "codex-panel-settings__dynamic-section",
        items: [
          {
            name: "Archived threads content",
            searchable: false,
            render: (setting) =>
              this.renderDeclarativeSection(setting, () => <ArchivedThreadsContent state={this.settingsViewModel().archived} />),
          },
        ],
      },
      {
        type: "group",
        heading: "Codex hooks",
        cls: "codex-panel-settings__dynamic-section",
        items: [
          {
            name: "Codex hooks content",
            searchable: false,
            render: (setting) => this.renderDeclarativeSection(setting, () => <CodexHooksContent state={this.settingsViewModel().hooks} />),
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (!(key in this.plugin.settings)) return undefined;
    return this.plugin.settings[key as keyof CodexPanelSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "showToolbar":
        if (typeof value === "boolean") await this.setShowToolbar(value);
        return;
      case "sendShortcut":
        if (value === "enter" || value === "mod-enter") await this.setSendShortcut(value);
        return;
      case "scrollThreadFromComposerEdges":
        if (typeof value === "boolean") await this.setScrollThreadFromComposerEdges(value);
        return;
      case "referenceActiveNoteOnSend":
        if (typeof value === "boolean") await this.setReferenceActiveNoteOnSend(value);
        return;
      case "archiveExportEnabled":
        if (typeof value === "boolean") await this.setArchiveExportEnabled(value);
        return;
      default:
        throw new Error(`Unknown declarative setting key: ${key}`);
    }
  }

  override hide(): void {
    this.renderMode = "hidden";
    this.declarativeIslandRefreshers.clear();
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = null;
    this.archivedDeleteConfirmThreadId = null;
    this.resources.dispose();
    unmountUiRoot(this.containerEl);
    super.hide();
  }

  private renderSettingsTab(options: { autoLoadResources: boolean }): void {
    const { containerEl } = this;
    containerEl.addClass("codex-panel-settings");
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = listenDomEvent(containerEl, "pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);

    this.renderLegacyView();

    if (options.autoLoadResources) this.maybeAutoLoadResources();
  }

  private beginDeclarativeDisplay(): void {
    if (this.renderMode === "declarative") return;
    this.renderMode = "declarative";
    this.containerEl.addClass("codex-panel-settings");
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = listenDomEvent(this.containerEl, "pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);
    this.resources.activate();
    queueMicrotask(() => {
      if (this.renderMode === "declarative") this.maybeAutoLoadResources();
    });
  }

  private renderDeclarativeControl(setting: Setting, renderNode: () => UiNode): () => void {
    return this.renderDeclarativeIsland(setting.controlEl, renderNode);
  }

  private renderDeclarativeSection(setting: Setting, renderNode: () => UiNode): () => void {
    setting.setClass("codex-panel-settings__declarative-section-island");
    setting.settingEl.empty();
    return this.renderDeclarativeIsland(setting.settingEl, renderNode);
  }

  private renderDeclarativeIsland(container: HTMLElement, renderNode: () => UiNode): () => void {
    this.beginDeclarativeDisplay();
    const refresh = (): void => {
      renderObsidianUiRoot(container, renderNode());
    };
    this.declarativeIslandRefreshers.add(refresh);
    refresh();
    return () => {
      this.declarativeIslandRefreshers.delete(refresh);
      unmountUiRoot(container);
    };
  }

  private commitTextDefinition(options: {
    name: string;
    desc: string;
    value: () => string;
    placeholder: string;
    normalizeValue: (value: string) => string;
    onCommit: (value: string) => Promise<void>;
  }): DeclarativeSettingDefinition {
    return {
      name: options.name,
      desc: options.desc,
      render: (setting) =>
        this.renderDeclarativeControl(setting, () => (
          <ObsidianCommitTextInput
            key={this.renderRevision}
            value={options.value()}
            placeholder={options.placeholder}
            normalizeValue={options.normalizeValue}
            onCommit={(value) => void options.onCommit(value)}
          />
        )),
    };
  }

  private renderLegacyView(): void {
    renderObsidianUiRoot(
      this.containerEl,
      <LegacySettingsView
        key={this.renderRevision}
        introText={SETTINGS_INTRO_TEXT}
        resourcesRefreshDisabled={!this.resources.canRefresh()}
        panel={{
          codexPath: this.plugin.settings.codexPath,
          showToolbar: this.plugin.settings.showToolbar,
          sendShortcut: this.plugin.settings.sendShortcut,
          scrollThreadFromComposerEdges: this.plugin.settings.scrollThreadFromComposerEdges,
          referenceActiveNoteOnSend: this.plugin.settings.referenceActiveNoteOnSend,
          attachmentFolder: this.plugin.settings.attachmentFolder,
        }}
        viewModel={this.settingsViewModel()}
        actions={{
          refreshResources: () => {
            void this.resources.refresh();
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

  private settingsViewModel(): SettingsViewModel {
    const resources = this.resources.snapshot();
    return {
      helper: {
        threadNamingModel: this.plugin.settings.threadNamingModel,
        threadNamingEffort: this.plugin.settings.threadNamingEffort,
        rewriteSelectionModel: this.plugin.settings.rewriteSelectionModel,
        rewriteSelectionEffort: this.plugin.settings.rewriteSelectionEffort,
        models: this.resources.modelMetadata(),
        modelError: resources.modelsLifecycle.kind === "failed" ? resources.modelsLifecycle.error : null,
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
        threads: resources.archivedThreads,
        loading: resources.archivedThreadsLifecycle.kind === "loading",
        error: resources.archivedThreadsLifecycle.kind === "failed" ? resources.archivedThreadsLifecycle.error : null,
        deleteConfirmThreadId: this.archivedDeleteConfirmThreadId,
        onExportEnabledChange: (enabled) => void this.setArchiveExportEnabled(enabled),
        onExportFolderTemplateChange: (value) => void this.setArchiveExportFolderTemplate(value),
        onExportFilenameTemplateChange: (value) => void this.setArchiveExportFilenameTemplate(value),
        onExportTagsChange: (value) => void this.setArchiveExportTags(value),
        onRestore: (threadId) => {
          this.archivedDeleteConfirmThreadId = null;
          this.requestRender();
          void this.resources.restoreArchivedThread(threadId);
        },
        onStartDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = threadId;
          this.requestRender();
        },
        onDelete: (threadId) => {
          this.archivedDeleteConfirmThreadId = null;
          this.requestRender();
          void this.resources.deleteArchivedThread(threadId);
        },
      },
      hooks: {
        catalog: resources.hookCatalog,
        loading: resources.hooksLifecycle.kind === "loading",
        error: resources.hooksLifecycle.kind === "failed" ? resources.hooksLifecycle.error : null,
        onTrust: (hook) => void this.resources.trustHook(hook),
        onToggleEnabled: (hook, enabled) => void this.resources.setHookEnabled(hook, enabled),
      },
    };
  }

  private maybeAutoLoadResources(): void {
    this.resources.maybeAutoLoad();
  }

  private setCodexPath(value: string): Promise<void> {
    const codexPath = normalizeCodexPath(value);
    return this.queueSettingsMutation((settings) => {
      if (codexPath === settings.codexPath) return false;
      settings.codexPath = codexPath;
      return true;
    });
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
      settings.attachmentFolder = normalizeAttachmentFolder(value);
    });
  }

  private setArchiveExportEnabled(enabled: boolean): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportEnabled = enabled;
    });
  }

  private setArchiveExportFolderTemplate(value: string): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportFolderTemplate = normalizeArchiveExportFolderTemplate(value);
    });
  }

  private setArchiveExportFilenameTemplate(value: string): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportFilenameTemplate = normalizeArchiveExportFilenameTemplate(value);
    });
  }

  private setArchiveExportTags(value: string): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.archiveExportTags = normalizeArchiveExportTags(value);
    });
  }

  private setThreadNamingModel(value: string | null): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.threadNamingModel = value;
      if (!this.resources.effortSupported(settings.threadNamingModel, settings.threadNamingEffort)) {
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
      if (!this.resources.effortSupported(settings.rewriteSelectionModel, settings.rewriteSelectionEffort)) {
        settings.rewriteSelectionEffort = null;
      }
    });
  }

  private setRewriteSelectionEffort(value: ReasoningEffort | null): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.rewriteSelectionEffort = value;
    });
  }

  private queueSettingsMutation(mutate: (settings: CodexPanelSettings) => boolean | undefined): Promise<void> {
    const operation = this.settingsMutationQueue.then(async () => {
      const candidateSettings: CodexPanelSettings = { ...this.plugin.settings };
      if (mutate(candidateSettings) === false) return;
      try {
        const { replacementResources } = await this.plugin.publishSettings(candidateSettings);
        if (replacementResources) this.resources.replaceResources(replacementResources);
      } catch (error) {
        this.renderRevision += 1;
        new Notice(`Could not apply Codex Panel settings: ${error instanceof Error ? error.message : String(error)}`);
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
    if (this.renderMode === "hidden") return;
    if (this.renderMode === "declarative") {
      for (const refresh of this.declarativeIslandRefreshers) refresh();
      return;
    }
    this.renderLegacyView();
  }
}
