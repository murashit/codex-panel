import type { ComponentChild as UiNode } from "preact";
import { shortThreadId } from "../domain/threads/id";
import type { Thread } from "../domain/threads/model";
import { threadArchiveDisplayTitle } from "../domain/threads/title";
import { ObsidianExtraButton, ObsidianTextInput, ObsidianToggle } from "../shared/obsidian/components.obsidian";
import type { ArchivedThreadSectionState } from "./section-state";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems, SettingsStatusRow } from "./setting-components";

export function ArchivedThreadSection({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <>
      <SettingsGroup className="codex-panel-settings__dynamic-section codex-panel-settings__archived-section">
        <SettingsHeading dynamic name="Thread archiving" desc="Set the default archive action and saved-note templates." />
        <ArchiveExportSettings state={state} />
      </SettingsGroup>
      <SettingsGroup className="codex-panel-settings__dynamic-section codex-panel-settings__archived-threads-section">
        <SettingsHeading dynamic name="Archived threads" desc="Restore or permanently delete archived Codex threads." />
        {state.contentAvailable ? (
          <ArchivedThreadList state={state} />
        ) : !state.loading && state.status ? (
          <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.status}</p>
        ) : null}
      </SettingsGroup>
    </>
  );
}

function ArchiveExportSettings({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <SettingsItems>
      <SettingRow name="Save note by default" desc="Save a Markdown note during the default archive action.">
        <ObsidianToggle
          checked={state.exportEnabled}
          onChange={(checked) => {
            state.onExportEnabledChange(checked);
          }}
        />
      </SettingRow>
      <SettingRow name="Saved note folder" desc="Vault folder for saved thread notes.">
        <ObsidianTextInput
          placeholder="Codex archives"
          value={state.exportFolderTemplate}
          onChange={(value) => {
            state.onExportFolderTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow name="Saved note filename" desc="Filename template. Supports {{date}}, {{time}}, {{title}}, {{id}}, and {{shortId}}.">
        <ObsidianTextInput
          placeholder="{{date}} {{time}} {{title}} {{shortId}}.md"
          value={state.exportFilenameTemplate}
          onChange={(value) => {
            state.onExportFilenameTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow name="Saved note tags" desc="Tags added to saved notes, separated by commas.">
        <ObsidianTextInput
          placeholder="Codex, archive"
          value={state.exportTags}
          onChange={(value) => {
            state.onExportTagsChange(value);
          }}
        />
      </SettingRow>
    </SettingsItems>
  );
}

function ArchivedThreadList({ state }: { state: ArchivedThreadSectionState }): UiNode {
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

function ArchivedThreadRow({ thread, state }: { thread: Thread; state: ArchivedThreadSectionState }): UiNode {
  const title = threadArchiveDisplayTitle(thread);
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
          onClick={() => {
            state.onRestore(thread.id);
          }}
        />
      ) : null}
      <ObsidianExtraButton
        icon={deleteConfirming ? "check" : "shredder"}
        label="Delete thread"
        className={deleteConfirming ? "codex-panel-settings__archived-delete-confirm" : "codex-panel-settings__archived-delete"}
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
