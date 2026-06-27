import type { ComponentChild as UiNode } from "preact";

import { shortThreadId } from "../../shared/id/thread-id";
import { IconButton } from "../../shared/ui/components.obsidian";
import { UnifiedDiffView } from "../../shared/ui/diff";
import { renderUiRoot } from "../../shared/ui/ui-root.dom";
import type { PersistedTurnDiffViewState, TurnDiffViewState } from "./model";

export interface TurnDiffViewActions {
  copyDiff?: () => void;
}

export function renderTurnDiffView(
  parent: HTMLElement,
  state: TurnDiffViewState | null,
  actions: TurnDiffViewActions = {},
  metadata: PersistedTurnDiffViewState | null = null,
): void {
  parent.addClass("codex-panel-turn-diff");
  renderUiRoot(parent, <TurnDiffView state={state} actions={actions} metadata={metadata} />);
}

function TurnDiffView({
  state,
  actions,
  metadata,
}: {
  state: TurnDiffViewState | null;
  actions: TurnDiffViewActions;
  metadata: PersistedTurnDiffViewState | null;
}): UiNode {
  if (!state) {
    if (metadata) {
      return (
        <>
          <TurnDiffHeader state={metadata} copyDiff={null} />
          <div className="codex-panel-turn-diff__empty">Turn diff is no longer available.</div>
        </>
      );
    }
    return <div className="codex-panel-turn-diff__empty">No turn diff selected.</div>;
  }

  return (
    <>
      <TurnDiffHeader state={state} copyDiff={actions.copyDiff ?? null} />
      {state.files.length > 0 ? <ChangedFiles files={state.files} /> : null}
      <UnifiedDiffView diff={state.diff} className="codex-panel-turn-diff__diff" />
    </>
  );
}

function TurnDiffHeader({
  state,
  copyDiff,
}: {
  state: PersistedTurnDiffViewState;
  copyDiff: TurnDiffViewActions["copyDiff"] | null;
}): UiNode {
  return (
    <div className="codex-panel-turn-diff__header">
      <div className="codex-panel-turn-diff__title-block">
        <div className="codex-panel-turn-diff__title">Turn diff</div>
        <div className="codex-panel-turn-diff__meta">
          {shortThreadId(state.threadId)} / {shortThreadId(state.turnId)} ·{" "}
          {state.files.length === 1 ? "Edited 1 file" : `Edited ${String(state.files.length)} files`}
        </div>
      </div>
      {copyDiff ? (
        <IconButton icon="copy" label="Copy diff" className="clickable-icon codex-panel-turn-diff__copy" onClick={copyDiff} />
      ) : null}
    </div>
  );
}

function ChangedFiles({ files }: { files: string[] }): UiNode {
  return (
    <details className="codex-panel-turn-diff__files">
      <summary tabIndex={-1}>Changed files</summary>
      <ul>
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </details>
  );
}
