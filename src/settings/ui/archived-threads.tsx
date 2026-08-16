import type { ComponentChild as UiNode } from "preact";
import { shortThreadId } from "../../domain/threads/id";
import type { Thread } from "../../domain/threads/model";
import { threadCommandDisplayTitle } from "../../domain/threads/title";
import { normalizeArchiveExportFilenameTemplate, normalizeArchiveExportFolderTemplate, normalizeArchiveExportTags } from "../preferences";
import { ObsidianCommitTextInput, ObsidianExtraButton, ObsidianToggle } from "./controls.obsidian";
import {
  ARCHIVE_EXPORT_ENABLED_SETTING,
  ARCHIVE_EXPORT_FILENAME_SETTING,
  ARCHIVE_EXPORT_FOLDER_SETTING,
  ARCHIVE_EXPORT_TAGS_SETTING,
} from "./definitions";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems, SettingsStatusRow } from "./layout";
import type { ArchivedThreadsViewModel } from "./view-model";

export function ArchivedThreadsSection({ state }: { state: ArchivedThreadsViewModel }): UiNode {
  return (
    <>
      <SettingsGroup className="codex-panel-settings__dynamic-section codex-panel-settings__archived-section">
        <SettingsHeading dynamic name="Thread archiving" />
        <ArchiveExportSettings state={state} />
      </SettingsGroup>
      <SettingsGroup className="codex-panel-settings__dynamic-section codex-panel-settings__archived-threads-section">
        <SettingsHeading dynamic name="Archived threads" />
        <ArchivedThreadsContent state={state} />
      </SettingsGroup>
    </>
  );
}

export function ArchivedThreadsContent({ state }: { state: ArchivedThreadsViewModel }): UiNode {
  return state.contentAvailable ? (
    <ArchivedThreadList state={state} />
  ) : !state.loading && state.status ? (
    <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.status}</p>
  ) : null;
}

function ArchiveExportSettings({ state }: { state: ArchivedThreadsViewModel }): UiNode {
  return (
    <SettingsItems>
      <SettingRow name={ARCHIVE_EXPORT_ENABLED_SETTING.name} desc={ARCHIVE_EXPORT_ENABLED_SETTING.desc}>
        <ObsidianToggle
          checked={state.exportEnabled}
          onChange={(checked) => {
            state.onExportEnabledChange(checked);
          }}
        />
      </SettingRow>
      <SettingRow name={ARCHIVE_EXPORT_FOLDER_SETTING.name} desc={ARCHIVE_EXPORT_FOLDER_SETTING.desc}>
        <ObsidianCommitTextInput
          placeholder={ARCHIVE_EXPORT_FOLDER_SETTING.placeholder}
          value={state.exportFolderTemplate}
          normalizeValue={normalizeArchiveExportFolderTemplate}
          onCommit={(value) => {
            state.onExportFolderTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow name={ARCHIVE_EXPORT_FILENAME_SETTING.name} desc={ARCHIVE_EXPORT_FILENAME_SETTING.desc}>
        <ObsidianCommitTextInput
          placeholder={ARCHIVE_EXPORT_FILENAME_SETTING.placeholder}
          value={state.exportFilenameTemplate}
          normalizeValue={normalizeArchiveExportFilenameTemplate}
          onCommit={(value) => {
            state.onExportFilenameTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow name={ARCHIVE_EXPORT_TAGS_SETTING.name} desc={ARCHIVE_EXPORT_TAGS_SETTING.desc}>
        <ObsidianCommitTextInput
          placeholder={ARCHIVE_EXPORT_TAGS_SETTING.placeholder}
          value={state.exportTags}
          normalizeValue={normalizeArchiveExportTags}
          onCommit={(value) => {
            state.onExportTagsChange(value);
          }}
        />
      </SettingRow>
    </SettingsItems>
  );
}

function ArchivedThreadList({ state }: { state: ArchivedThreadsViewModel }): UiNode {
  return (
    <SettingsItems className="codex-panel-settings__dynamic-list codex-panel-settings__archived-list">
      {state.threads.length === 0 ? (
        <SettingsStatusRow>No archived threads.</SettingsStatusRow>
      ) : (
        state.threads.map((thread) => <ArchivedThreadRow key={thread.id} thread={thread} state={state} />)
      )}
    </SettingsItems>
  );
}

function ArchivedThreadRow({ thread, state }: { thread: Thread; state: ArchivedThreadsViewModel }): UiNode {
  const title = threadCommandDisplayTitle(thread);
  const deleteConfirming = state.deleteConfirmThreadId === thread.id;
  return (
    <SettingRow
      className={`codex-panel-settings__dynamic-row codex-panel-settings__archived-row ${
        deleteConfirming ? "codex-panel-settings__archived-row--delete-confirming" : ""
      }`}
      name={title}
      desc={
        deleteConfirming
          ? "Permanently delete this archived thread? This cannot be undone."
          : `Updated ${formatThreadDate(thread.updatedAt)} · ${shortThreadId(thread.id)}`
      }
    >
      {!deleteConfirming ? (
        <ObsidianExtraButton
          icon="rotate-ccw"
          label="Restore thread"
          className="codex-panel-settings__archived-restore"
          disabled={state.loading}
          onClick={() => {
            state.onRestore(thread.id);
          }}
        />
      ) : null}
      <ObsidianExtraButton
        icon={deleteConfirming ? "check" : "shredder"}
        label="Delete thread"
        className={deleteConfirming ? "codex-panel-settings__archived-delete-confirm" : "codex-panel-settings__archived-delete"}
        disabled={state.loading}
        onClick={() => {
          if (deleteConfirming) {
            state.onDelete(thread.id);
          } else {
            state.onStartDelete(thread.id);
          }
        }}
      />
    </SettingRow>
  );
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
