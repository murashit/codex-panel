import { Setting } from "obsidian";

import type { HookMetadata } from "../generated/app-server/v2/HookMetadata";
import type { Thread } from "../generated/app-server/v2/Thread";
import { archivedThreadDisplayTitle, fullThreadTitle } from "../threads/model";
import { shortThreadId } from "../utils";

export interface ArchivedThreadSectionState {
  exportEnabled: boolean;
  exportFolderTemplate: string;
  exportFilenameTemplate: string;
  exportTags: string;
  threads: Thread[];
  loaded: boolean;
  loading: boolean;
  status: string;
  onExportEnabledChange(enabled: boolean): void;
  onExportFolderTemplateChange(value: string): void;
  onExportFilenameTemplateChange(value: string): void;
  onExportTagsChange(value: string): void;
  onRestore(threadId: string): void;
}

export interface HookSectionState {
  hooks: HookMetadata[];
  warnings: string[];
  errors: string[];
  loaded: boolean;
  loading: boolean;
  status: string;
  onTrust(hook: HookMetadata): void;
  onToggleEnabled(hook: HookMetadata, enabled: boolean): void;
}

export function renderHookSection(containerEl: HTMLElement, state: HookSectionState): void {
  const section = containerEl.createDiv({ cls: "codex-panel-settings__dynamic-section codex-panel-settings__hook-section" });
  new Setting(section)
    .setClass("codex-panel-settings__dynamic-section-heading")
    .setHeading()
    .setName("Hook status")
    .setDesc("Review hooks discovered for this vault root, including trust and enabled state.");

  if (state.loading) {
    section.createEl("p", { cls: "setting-item-description codex-panel-settings__dynamic-section-status", text: "Loading hooks..." });
  } else if (state.loaded) {
    renderHooks(section, state);
  } else if (state.status) {
    section.createEl("p", { cls: "setting-item-description codex-panel-settings__dynamic-section-status", text: state.status });
  }
}

export function renderArchivedThreadSection(containerEl: HTMLElement, state: ArchivedThreadSectionState): void {
  const section = containerEl.createDiv({
    cls: "codex-panel-settings__dynamic-section codex-panel-settings__archived-section",
  });
  new Setting(section)
    .setClass("codex-panel-settings__dynamic-section-heading")
    .setHeading()
    .setName("Archive actions")
    .setDesc("Configure what happens when a thread is archived, and restore already archived threads when needed.");

  renderArchiveExportSettings(section, state);

  if (state.loading) {
    section.createEl("p", {
      cls: "setting-item-description codex-panel-settings__dynamic-section-status",
      text: "Loading archived threads...",
    });
  } else if (state.loaded && state.threads.length === 0) {
    section.createEl("p", {
      cls: "setting-item-description codex-panel-settings__dynamic-section-status",
      text: "No archived threads.",
    });
  } else if (state.loaded) {
    renderArchivedThreadList(section, state);
  } else if (state.status) {
    section.createEl("p", {
      cls: "setting-item-description codex-panel-settings__dynamic-section-status",
      text: state.status,
    });
  }
}

function renderArchiveExportSettings(containerEl: HTMLElement, state: ArchivedThreadSectionState): void {
  new Setting(containerEl)
    .setName("Save before archiving")
    .setDesc(
      "Save a markdown note before archiving. If saving fails, the thread is not archived. Frontmatter includes title, thread_id, created, and optional tags.",
    )
    .addToggle((toggle) => {
      toggle.setValue(state.exportEnabled).onChange((value) => {
        state.onExportEnabledChange(value);
      });
    });

  new Setting(containerEl)
    .setName("Save folder")
    .setDesc("Vault-relative folder path. The folder is created when needed.")
    .addText((text) => {
      text
        .setPlaceholder("Codex archives")
        .setValue(state.exportFolderTemplate)
        .onChange((value) => {
          state.onExportFolderTemplateChange(value);
        });
    });

  new Setting(containerEl)
    .setName("Save filename")
    .setDesc(
      "Markdown filename template. Available variables: {{date}}, {{time}}, {{title}}, {{id}}, {{shortId}}. Existing files get a numeric suffix.",
    )
    .addText((text) => {
      text
        .setPlaceholder("{{date}} {{time}} {{title}} {{shortId}}.md")
        .setValue(state.exportFilenameTemplate)
        .onChange((value) => {
          state.onExportFilenameTemplateChange(value);
        });
    });

  new Setting(containerEl)
    .setName("Save tags")
    .setDesc("Comma-separated fixed tags for saved notes. Variables are not expanded. Leave empty to omit tags.")
    .addText((text) => {
      text
        .setPlaceholder("Codex, archive")
        .setValue(state.exportTags)
        .onChange((value) => {
          state.onExportTagsChange(value);
        });
    });
}

function renderArchivedThreadList(containerEl: HTMLElement, state: ArchivedThreadSectionState): void {
  containerEl.createEl("p", {
    cls: "setting-item-description codex-panel-settings__dynamic-list-summary",
    text: `Archived threads below can be restored to chat history. Loaded ${state.threads.length} archived thread${
      state.threads.length === 1 ? "" : "s"
    } from Codex app-server.`,
  });
  const list = containerEl.createDiv({ cls: "setting-items codex-panel-settings__dynamic-list codex-panel-settings__archived-list" });
  for (const thread of state.threads) {
    const title = archivedThreadDisplayTitle(thread);
    const setting = new Setting(list)
      .setClass("codex-panel-settings__dynamic-row")
      .setName(title)
      .setDesc(`Updated ${formatThreadDate(thread.updatedAt)} · ${shortThreadId(thread.id)}`)
      .addExtraButton((button) => {
        button.setIcon("rotate-ccw").onClick(() => {
          state.onRestore(thread.id);
        });
        button.extraSettingsEl.addClass("codex-panel-settings__archived-restore");
        button.extraSettingsEl.setAttr("aria-label", `Restore ${title}`);
      });
    setting.settingEl.addClass("codex-panel-settings__archived-row");
    setting.settingEl.setAttr("title", fullThreadTitle(thread));
  }
}

function renderHooks(containerEl: HTMLElement, state: HookSectionState): void {
  if (state.hooks.length === 0) {
    containerEl.createEl("p", { cls: "setting-item-description", text: "No hooks discovered for the current vault root." });
  } else {
    containerEl.createEl("p", {
      cls: "setting-item-description codex-panel-settings__dynamic-list-summary",
      text: `Loaded ${state.hooks.length} hook${state.hooks.length === 1 ? "" : "s"} from Codex app-server.`,
    });
    const list = containerEl.createDiv({ cls: "setting-items codex-panel-settings__dynamic-list codex-panel-settings__hook-list" });
    for (const hook of state.hooks) {
      renderHookRow(list, hook, state);
    }
  }

  for (const warning of state.warnings) {
    containerEl.createEl("p", { cls: "setting-item-description codex-panel-settings__hook-warning", text: warning });
  }
  for (const error of state.errors) {
    containerEl.createEl("p", { cls: "setting-item-description codex-panel-settings__hook-error", text: error });
  }
}

function renderHookRow(list: HTMLElement, hook: HookMetadata, state: HookSectionState): void {
  const canTrust = !hook.isManaged && (hook.trustStatus === "untrusted" || hook.trustStatus === "modified");
  const hookName = firstNonEmptyString(hook.statusMessage, hook.command, hook.matcher, hook.eventName);
  const setting = new Setting(list)
    .setClass("codex-panel-settings__dynamic-row")
    .setName(hookName)
    .setDesc(`${hook.eventName} · ${hook.matcher ?? "(no matcher)"} · ${hook.trustStatus} · ${hook.enabled ? "enabled" : "disabled"}`)
    .addButton((button) => {
      button
        .setButtonText("Trust")
        .setDisabled(state.loading || !canTrust)
        .onClick(() => {
          state.onTrust(hook);
        });
    })
    .addButton((button) => {
      button
        .setButtonText(hook.enabled ? "Disable" : "Enable")
        .setDisabled(state.loading || hook.isManaged)
        .onClick(() => {
          state.onToggleEnabled(hook, !hook.enabled);
        });
    });
  setting.settingEl.addClass("codex-panel-settings__hook-row");
  setting.settingEl.setAttr("title", hook.command ?? hook.key);
  setting.descEl.createDiv({
    cls: "codex-panel-settings__hook-hash",
    text: hook.currentHash,
    attr: { title: hook.key },
  });
}

function firstNonEmptyString(...values: string[]): string {
  return values.find((value) => value.length > 0) ?? values[values.length - 1] ?? "";
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
