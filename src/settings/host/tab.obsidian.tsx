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

import { DEFAULT_CODEX_PATH } from "../../constants";
import type { SendShortcut } from "../../domain/input/send-shortcut";
import { listenDomEvent } from "../../shared/dom/events.dom";
import { unmountUiRoot } from "../../shared/dom/preact-root.dom";
import { renderObsidianUiRoot } from "../../shared/obsidian/preact-root.obsidian";
import { IconButton } from "../../shared/ui/icon.dom";
import { SettingsResourcesController } from "../application/resources-controller";
import {
  type CodexPanelSettings,
  DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
  DEFAULT_ARCHIVE_EXPORT_FOLDER_TEMPLATE,
  DEFAULT_ATTACHMENT_FOLDER,
  normalizeArchiveExportFilenameTemplate,
  normalizeArchiveExportFolderTemplate,
  normalizeArchiveExportTags,
  normalizeAttachmentFolder,
  normalizeCodexPath,
} from "../preferences";
import { ArchivedThreadsContent, type ArchivedThreadsViewModel } from "../ui/archived-threads";
import { CodexHooksContent, type CodexHooksViewModel } from "../ui/codex-hooks";
import { ObsidianCommitTextInput } from "../ui/controls.obsidian";
import { ModelEffortControl } from "../ui/panel-helpers";
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
    const selectionRewriteDescription = "Model and effort used by Rewrite selection.";
    return [
      {
        name: "Codex details",
        desc: "Codex Panel stores panel preferences only. Runtime settings still come from Codex.",
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
      this.commitTextDefinition({
        name: "Codex executable",
        desc: "Command used to start `codex app-server`. Use an absolute path when Obsidian cannot find `codex`.",
        value: () => this.plugin.settings.codexPath,
        placeholder: DEFAULT_CODEX_PATH,
        normalizeValue: normalizeCodexPath,
        onCommit: (value) => this.setCodexPath(value),
      }),
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
                return (
                  <ModelEffortControl
                    modelValue={this.plugin.settings.threadNamingModel}
                    effortValue={this.plugin.settings.threadNamingEffort}
                    models={this.resources.modelMetadata()}
                    onModelChange={(value) => void this.setThreadNamingModel(value)}
                    onEffortChange={(value) => void this.setPreference("threadNamingEffort", value)}
                  />
                );
              }),
          },
          {
            name: "Selection rewrite",
            desc: selectionRewriteDescription,
            render: (setting) =>
              this.renderDeclarativeControl(setting, () => {
                const modelsLifecycle = this.resources.snapshot().modelsLifecycle;
                const modelError = modelsLifecycle.kind === "failed" ? modelsLifecycle.error : null;
                setting.setDesc(modelError ? `${selectionRewriteDescription} ${modelError}` : selectionRewriteDescription);
                return (
                  <ModelEffortControl
                    modelValue={this.plugin.settings.rewriteSelectionModel}
                    effortValue={this.plugin.settings.rewriteSelectionEffort}
                    models={this.resources.modelMetadata()}
                    onModelChange={(value) => void this.setRewriteSelectionModel(value)}
                    onEffortChange={(value) => void this.setPreference("rewriteSelectionEffort", value)}
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
              options: { enter: "Enter", "mod-enter": "Cmd/Ctrl+Enter" } satisfies Record<SendShortcut, string>,
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
          this.commitTextDefinition({
            name: "Attachment folder",
            desc: "Vault-relative folder for files pasted or dropped into composer inputs.",
            value: () => this.plugin.settings.attachmentFolder,
            placeholder: DEFAULT_ATTACHMENT_FOLDER,
            normalizeValue: normalizeAttachmentFolder,
            onCommit: (value) => this.setPreference("attachmentFolder", normalizeAttachmentFolder(value)),
          }),
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
            normalizeValue: normalizeArchiveExportFolderTemplate,
            onCommit: (value) => this.setPreference("archiveExportFolderTemplate", normalizeArchiveExportFolderTemplate(value)),
          }),
          this.commitTextDefinition({
            name: "Saved note filename",
            desc: "Filename template. Supports {{date}}, {{time}}, {{title}}, {{id}}, and {{shortId}}.",
            value: () => this.plugin.settings.archiveExportFilenameTemplate,
            placeholder: DEFAULT_ARCHIVE_EXPORT_FILENAME_TEMPLATE,
            normalizeValue: normalizeArchiveExportFilenameTemplate,
            onCommit: (value) => this.setPreference("archiveExportFilenameTemplate", normalizeArchiveExportFilenameTemplate(value)),
          }),
          this.commitTextDefinition({
            name: "Saved note tags",
            desc: "Comma-separated tags added to saved thread notes.",
            value: () => this.plugin.settings.archiveExportTags,
            placeholder: "codex, archive",
            normalizeValue: normalizeArchiveExportTags,
            onCommit: (value) => this.setPreference("archiveExportTags", normalizeArchiveExportTags(value)),
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
      case "scrollThreadFromComposerEdges":
      case "referenceActiveNoteOnSend":
      case "archiveExportEnabled":
        if (typeof value === "boolean") await this.setPreference(key, value);
        return;
      case "sendShortcut":
        if (value === "enter" || value === "mod-enter") await this.setPreference(key, value);
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
      if (this.displayed) this.resources.maybeAutoLoad();
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

  private setCodexPath(value: string): Promise<void> {
    const codexPath = normalizeCodexPath(value);
    return this.queueSettingsMutation((settings) => {
      if (codexPath === settings.codexPath) return false;
      settings.codexPath = codexPath;
      return true;
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

  private setRewriteSelectionModel(value: string | null): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings.rewriteSelectionModel = value;
      if (!this.resources.effortSupported(settings.rewriteSelectionModel, settings.rewriteSelectionEffort)) {
        settings.rewriteSelectionEffort = null;
      }
    });
  }

  private setPreference<Key extends keyof CodexPanelSettings>(key: Key, value: CodexPanelSettings[Key]): Promise<void> {
    return this.queueSettingsMutation((settings) => {
      settings[key] = value;
    });
  }

  private queueSettingsMutation(mutate: (settings: CodexPanelSettings) => boolean | undefined): Promise<void> {
    const operation = this.settingsMutationQueue.then(async () => {
      const candidateSettings: CodexPanelSettings = { ...this.plugin.settings };
      if (mutate(candidateSettings) === false) return;
      try {
        const { replacementResources } = await this.plugin.publishSettings(candidateSettings);
        if (replacementResources) {
          this.resources.replaceResources(replacementResources);
          if (this.displayed) this.resources.maybeAutoLoad();
        }
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
