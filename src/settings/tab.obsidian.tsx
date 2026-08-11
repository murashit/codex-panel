import { type App, Notice, type Plugin, PluginSettingTab, type Setting } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import { DEFAULT_CODEX_PATH } from "../constants";
import type { ReasoningEffort } from "../domain/catalog/metadata";
import { listenDomEvent } from "../shared/dom/events.dom";
import { unmountUiRoot } from "../shared/dom/preact-root.dom";
import { renderObsidianUiRoot } from "../shared/obsidian/preact-root.obsidian";
import { IconButton } from "../shared/ui/icon.dom";
import { ArchivedThreadsContent } from "./archived-section";
import { ObsidianCommitTextInput } from "./controls.obsidian";
import type { DeclarativeSettingDefinition, DeclarativeSettingDefinitionItem } from "./declarative-settings.compat";
import { SettingsDynamicSectionsController } from "./dynamic-sections-controller";
import { ModelEffortControl } from "./helper-section";
import { HooksContent } from "./hook-section";
import type { CodexPanelSettingTabHost } from "./host";
import type { CodexPanelSettings } from "./model";
import { DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE, DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE, DEFAULT_ATTACHMENT_FOLDER } from "./model";
import type { SettingsSectionsState } from "./section-state";
import { SettingsTabShell } from "./tab-shell";

const SETTINGS_INTRO_TEXT = "Codex Panel stores panel preferences only. Runtime settings still come from Codex.";
const ARCHIVE_EXPORT_TAGS_PLACEHOLDER = "codex, archive";

export class CodexPanelSettingTab extends PluginSettingTab {
  private readonly dynamicSections: SettingsDynamicSectionsController;
  private renderMode: "hidden" | "legacy" | "declarative" = "hidden";
  private settingsShellRevision = 0;
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
    this.renderMode = "legacy";
    this.dynamicSections.activate();
    this.renderSettingsTab({ autoLoadDynamicSections: true });
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
              label={this.dynamicSections.canRefreshDynamicSections() ? "Refresh Codex details" : "Refreshing Codex details"}
              className="clickable-icon codex-panel-settings__refresh-button"
              disabled={!this.dynamicSections.canRefreshDynamicSections()}
              onClick={() => void this.dynamicSections.refreshDynamicSections()}
            />
          )),
      },
      {
        name: "Codex executable",
        desc: "Command used to start `codex app-server`. Use an absolute path when Obsidian cannot find `codex`.",
        render: (setting) =>
          this.renderDeclarativeControl(setting, () => (
            <ObsidianCommitTextInput
              key={this.settingsShellRevision}
              value={this.plugin.settings.codexPath}
              placeholder={DEFAULT_CODEX_PATH}
              normalizeValue={(value) => value.trim() || DEFAULT_CODEX_PATH}
              onCommit={(value) => void this.setCodexPath(value)}
            />
          )),
      },
      {
        name: "Show chat toolbar",
        desc: "Shows the toolbar above chat panels.",
        control: { type: "toggle", key: "showToolbar" },
      },
      {
        type: "group",
        heading: "Panel helpers",
        cls: "codex-panel-settings__section",
        items: [
          {
            name: "Automatic thread naming",
            desc: "Model and effort used when Codex Panel generates thread names.",
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => {
                const helper = this.settingsSectionsState().helper;
                return (
                  <ModelEffortControl
                    name="Automatic thread naming"
                    desc="Model and effort used when Codex Panel generates thread names."
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
            name: "Selection rewrite",
            desc: "Model and effort used by Rewrite selection.",
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => {
                const helper = this.settingsSectionsState().helper;
                setting.setDesc(
                  helper.modelLoadFailed
                    ? `Model and effort used by Rewrite selection. ${helper.modelStatus}`
                    : "Model and effort used by Rewrite selection.",
                );
                return (
                  <ModelEffortControl
                    name="Selection rewrite"
                    desc="Model and effort used by Rewrite selection."
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
            name: "Send shortcut",
            desc: "Controls whether Enter or Cmd/Ctrl+Enter sends composer-style inputs. Shift+Enter adds a newline.",
            control: {
              type: "dropdown",
              key: "sendShortcut",
              defaultValue: "enter",
              options: { enter: "Enter", "mod-enter": "Cmd/Ctrl+Enter" },
            },
          },
          {
            name: "Scroll conversation from composer line edges",
            desc: "Lets Up/Ctrl+P and Down/Ctrl+N scroll the conversation from composer line edges.",
            control: { type: "toggle", key: "scrollThreadFromComposerEdges" },
          },
          {
            name: "Reference active file on send",
            desc: "Adds the active file as context on each send without changing the prompt text.",
            control: { type: "toggle", key: "referenceActiveNoteOnSend" },
          },
          {
            name: "Attachment folder",
            desc: "Vault-relative folder for files pasted or dropped into composer inputs.",
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => (
                <ObsidianCommitTextInput
                  key={this.settingsShellRevision}
                  value={this.plugin.settings.attachmentFolder}
                  placeholder={DEFAULT_ATTACHMENT_FOLDER}
                  normalizeValue={(value) => value.trim() || DEFAULT_ATTACHMENT_FOLDER}
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
            name: "Save note by default",
            desc: "Makes Save and archive thread the default archive action.",
            control: { type: "toggle", key: "archiveExportEnabled" },
          },
          this.commitTextDefinition({
            name: "Saved note folder",
            desc: "Vault-relative folder for archived thread notes.",
            value: () => this.plugin.settings.archiveExportFolderTemplate,
            placeholder: DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE,
            normalizeValue: (value) => value.trim() || DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE,
            onCommit: (value) => this.setArchiveExportFolderTemplate(value),
          }),
          this.commitTextDefinition({
            name: "Saved note filename",
            desc: "Filename template. Supports {{date}}, {{time}}, {{title}}, {{id}}, and {{shortId}}.",
            value: () => this.plugin.settings.archiveExportFilenameTemplate,
            placeholder: DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
            normalizeValue: (value) => value.trim() || DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
            onCommit: (value) => this.setArchiveExportFilenameTemplate(value),
          }),
          this.commitTextDefinition({
            name: "Saved note tags",
            desc: "Comma-separated tags added to saved thread notes.",
            value: () => this.plugin.settings.archiveExportTags,
            placeholder: ARCHIVE_EXPORT_TAGS_PLACEHOLDER,
            normalizeValue: (value) => value.trim(),
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
              this.renderDeclarativeSection(setting, () => <ArchivedThreadsContent state={this.settingsSectionsState().archived} />),
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
            render: (setting) => this.renderDeclarativeSection(setting, () => <HooksContent state={this.settingsSectionsState().hooks} />),
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

  private beginDeclarativeDisplay(): void {
    if (this.renderMode === "declarative") return;
    this.renderMode = "declarative";
    this.containerEl.addClass("codex-panel-settings");
    this.disposeOutsidePointer?.();
    this.disposeOutsidePointer = listenDomEvent(this.containerEl, "pointerdown", this.cancelArchivedDeleteConfirmOnOutsidePointer);
    this.dynamicSections.activate();
    queueMicrotask(() => {
      if (this.renderMode === "declarative") this.maybeAutoLoadDynamicSections();
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
            key={this.settingsShellRevision}
            value={options.value()}
            placeholder={options.placeholder}
            normalizeValue={options.normalizeValue}
            onCommit={(value) => void options.onCommit(value)}
          />
        )),
    };
  }

  private renderSettingsShell(): void {
    renderObsidianUiRoot(
      this.containerEl,
      <SettingsTabShell
        key={this.settingsShellRevision}
        introText={SETTINGS_INTRO_TEXT}
        dynamicSectionsRefreshDisabled={!this.dynamicSections.canRefreshDynamicSections()}
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

  private queueSettingsMutation(mutate: (settings: CodexPanelSettings) => boolean | undefined): Promise<void> {
    const operation = this.settingsMutationQueue.then(async () => {
      const candidateSettings: CodexPanelSettings = { ...this.plugin.settings };
      if (mutate(candidateSettings) === false) return;
      try {
        const { replacementDynamicData } = await this.plugin.publishSettings(candidateSettings);
        if (replacementDynamicData) this.dynamicSections.replaceDynamicData(replacementDynamicData);
      } catch (error) {
        this.settingsShellRevision += 1;
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
    this.renderSettingsShell();
  }
}
