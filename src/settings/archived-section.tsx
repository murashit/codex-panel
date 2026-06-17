import type { ComponentChild as UiNode } from "preact";

import type { Thread } from "../domain/threads/model";
import { shortThreadId } from "../utils";
import { archivedThreadDisplayTitle } from "./archived-thread-title";
import type { ArchivedThreadSectionState } from "./section-state";
import { SettingRow, SettingsHeading, SettingsIconButton, TextControl, ToggleControl } from "./setting-components";

export function ArchivedThreadSection({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <section className="codex-panel-settings__dynamic-section codex-panel-settings__archived-section">
      <SettingsHeading
        dynamic
        name="Thread archiving"
        desc="Choose the default archive behavior and configure saved thread notes. Thread lists offer both archive choices; slash commands use the default."
      />
      <ArchiveExportSettings state={state} />
      {state.loaded && state.threads.length === 0 ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">No archived threads.</p>
      ) : state.loaded ? (
        <ArchivedThreadList state={state} />
      ) : !state.loading && state.status ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.status}</p>
      ) : null}
    </section>
  );
}

function ArchiveExportSettings({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <>
      <SettingRow
        name="Save note by default"
        desc="When on, the default archive action saves a markdown note before archiving. When off, the default archives without saving. If saving fails, the thread stays active. Frontmatter includes title, thread_id, created, and optional tags."
      >
        <ToggleControl
          checked={state.exportEnabled}
          onChange={(checked) => {
            state.onExportEnabledChange(checked);
          }}
        />
      </SettingRow>
      <SettingRow name="Saved note folder" desc="Vault-relative folder for saved thread notes. The folder is created when needed.">
        <TextControl
          placeholder="Codex archives"
          value={state.exportFolderTemplate}
          onChange={(value) => {
            state.onExportFolderTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow
        name="Saved note filename"
        desc="Filename template. Variables: {{date}}, {{time}}, {{title}}, {{id}}, {{shortId}}. Existing files get a numeric suffix."
      >
        <TextControl
          placeholder="{{date}} {{time}} {{title}} {{shortId}}.md"
          value={state.exportFilenameTemplate}
          onChange={(value) => {
            state.onExportFilenameTemplateChange(value);
          }}
        />
      </SettingRow>
      <SettingRow name="Saved note tags" desc="Comma-separated fixed tags for saved notes. Leave empty to omit tags.">
        <TextControl
          placeholder="Codex, archive"
          value={state.exportTags}
          onChange={(value) => {
            state.onExportTagsChange(value);
          }}
        />
      </SettingRow>
    </>
  );
}

function ArchivedThreadList({ state }: { state: ArchivedThreadSectionState }): UiNode {
  return (
    <>
      <p className="setting-item-description codex-panel-settings__dynamic-list-summary">
        Restore archived threads, or permanently delete archived threads you no longer need.
      </p>
      <div className="setting-items codex-panel-settings__dynamic-list codex-panel-settings__archived-list">
        {state.threads.map((thread) => (
          <ArchivedThreadRow key={thread.id} thread={thread} state={state} />
        ))}
      </div>
    </>
  );
}

function ArchivedThreadRow({ thread, state }: { thread: Thread; state: ArchivedThreadSectionState }): UiNode {
  const title = archivedThreadDisplayTitle(thread);
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
        <SettingsIconButton
          icon="rotate-ccw"
          label={`Restore ${title}`}
          className="codex-panel-settings__archived-restore"
          onClick={() => {
            state.onRestore(thread.id);
          }}
        />
      ) : null}
      <SettingsIconButton
        icon={deleteConfirming ? "check" : "shredder"}
        label={deleteConfirming ? `Confirm permanent delete ${title}` : `Delete ${title}`}
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
