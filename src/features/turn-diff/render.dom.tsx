import type { ComponentChild as UiNode } from "preact";

import { shortThreadId } from "../../domain/threads/id";
import { renderUiRoot } from "../../shared/dom/preact-root.dom";
import { IconButton } from "../../shared/obsidian/components.obsidian";
import { UnifiedDiffView } from "../../shared/ui/diff-view";
import type { TurnDiffViewState } from "./model";

export interface TurnDiffViewActions {
  copyDiff?: () => void;
}

export function renderTurnDiffView(parent: HTMLElement, state: TurnDiffViewState | null, actions: TurnDiffViewActions = {}): void {
  parent.addClass("codex-panel-turn-diff");
  renderUiRoot(parent, <TurnDiffView state={state} actions={actions} />);
}

function TurnDiffView({ state, actions }: { state: TurnDiffViewState | null; actions: TurnDiffViewActions }): UiNode {
  if (!state) {
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

function TurnDiffHeader({ state, copyDiff }: { state: TurnDiffViewState; copyDiff: TurnDiffViewActions["copyDiff"] | null }): UiNode {
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
