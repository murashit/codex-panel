import type { ComponentChild as UiNode } from "preact";
import { shortThreadId } from "../../domain/threads/id";
import type { Thread } from "../../domain/threads/model";
import { threadCommandDisplayTitle } from "../../domain/threads/title";
import { ObsidianExtraButton } from "./controls.obsidian";
import { SettingRow, SettingsItems, SettingsStatusRow } from "./layout";
import type { ArchivedThreadsViewModel } from "./view-model";

export function ArchivedThreadsContent({ state }: { state: ArchivedThreadsViewModel }): UiNode {
  const threads = state.threads;
  return (
    <>
      {threads ? <ArchivedThreadList threads={threads} state={state} /> : null}
      {!state.loading && state.error ? (
        <p className="setting-item-description codex-panel-settings__dynamic-section-status">{state.error}</p>
      ) : null}
    </>
  );
}

function ArchivedThreadList({ threads, state }: { threads: readonly Thread[]; state: ArchivedThreadsViewModel }): UiNode {
  return (
    <SettingsItems className="codex-panel-settings__dynamic-list codex-panel-settings__archived-list">
      {threads.length === 0 ? (
        <SettingsStatusRow>No archived threads.</SettingsStatusRow>
      ) : (
        threads.map((thread) => <ArchivedThreadRow key={thread.id} thread={thread} state={state} />)
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
