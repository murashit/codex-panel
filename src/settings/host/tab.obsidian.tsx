import {
  type App,
  Notice,
  type Plugin,
  PluginSettingTab,
  type Setting,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
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
import { ModelEffortControl } from "../ui/panel-helpers";
import type { ArchivedThreadsViewModel, CodexHooksViewModel, PanelHelpersViewModel } from "../ui/view-model";
import type { SettingsTabHost } from "./contracts";

export class CodexPanelSettingTab extends PluginSettingTab {
  private readonly resources: SettingsResourcesController;
  private displayed = false;
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

  override getSettingDefinitions(): SettingDefinitionItem[] {
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
                const helper = this.panelHelpersViewModel();
                return (
                  <ModelEffortControl
                    modelValue={helper.threadNamingModel}
                    effortValue={helper.threadNamingEffort}
                    models={helper.models}
                    onModelChange={helper.onThreadNamingModelChange}
                    onEffortChange={helper.onThreadNamingEffortChange}
                  />
                );
              }),
          },
          {
            name: SELECTION_REWRITE_SETTING.name,
            desc: SELECTION_REWRITE_SETTING.desc,
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => {
                const helper = this.panelHelpersViewModel();
                setting.setDesc(
                  helper.modelError ? `${SELECTION_REWRITE_SETTING.desc} ${helper.modelError}` : SELECTION_REWRITE_SETTING.desc,
                );
                return (
                  <ModelEffortControl
                    modelValue={helper.rewriteSelectionModel}
                    effortValue={helper.rewriteSelectionEffort}
                    models={helper.models}
                    onModelChange={helper.onRewriteSelectionModelChange}
                    onEffortChange={helper.onRewriteSelectionEffortChange}
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
              this.renderDeclarativeSection(setting, () => <ArchivedThreadsContent state={this.archivedThreadsViewModel()} />),
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
            render: (setting) => this.renderDeclarativeSection(setting, () => <CodexHooksContent state={this.codexHooksViewModel()} />),
          },
        ],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    if (!(key in this.plugin.settings)) return undefined;
    return this.plugin.settings[key as keyof CodexPanelSettings];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
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
    this.displayed = false;
    this.declarativeIslandRefreshers.clear();
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = null;
    this.archivedDeleteConfirmThreadId = null;
    this.resources.dispose();
    unmountUiRoot(this.containerEl);
    super.hide();
  }

  private beginDeclarativeDisplay(): void {
    if (this.displayed) return;
    this.displayed = true;
    this.containerEl.addClass("codex-panel-settings");
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = listenDomEvent(this.containerEl, "pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);
    this.resources.activate();
    queueMicrotask(() => {
      if (this.displayed) this.maybeAutoLoadResources();
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
  }): SettingDefinition {
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

  private panelHelpersViewModel(): PanelHelpersViewModel {
    const resources = this.resources.snapshot();
    return {
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
    };
  }

  private archivedThreadsViewModel(): ArchivedThreadsViewModel {
    const resources = this.resources.snapshot();
    return {
      threads: resources.archivedThreads,
      loading: resources.archivedThreadsLifecycle.kind === "loading",
      error: resources.archivedThreadsLifecycle.kind === "failed" ? resources.archivedThreadsLifecycle.error : null,
      deleteConfirmThreadId: this.archivedDeleteConfirmThreadId,
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
    };
  }

  private codexHooksViewModel(): CodexHooksViewModel {
    const resources = this.resources.snapshot();
    return {
      catalog: resources.hookCatalog,
      loading: resources.hooksLifecycle.kind === "loading",
      error: resources.hooksLifecycle.kind === "failed" ? resources.hooksLifecycle.error : null,
      onTrust: (hook) => void this.resources.trustHook(hook),
      onToggleEnabled: (hook, enabled) => void this.resources.setHookEnabled(hook, enabled),
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
    if (!this.displayed) return;
    for (const refresh of this.declarativeIslandRefreshers) refresh();
  }
}
