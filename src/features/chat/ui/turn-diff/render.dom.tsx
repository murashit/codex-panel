import type { ComponentChild as UiNode } from "preact";

import { shortThreadId } from "../../../../shared/id/thread-id";
import { IconButton } from "../../../../shared/ui/components.obsidian";
import { UnifiedDiffView } from "../../../../shared/ui/diff";
import { renderUiRoot } from "../../../../shared/ui/ui-root.dom";
import type { ChatTurnDiffViewState, PersistedChatTurnDiffViewState } from "../../domain/turn-diff";

export interface ChatTurnDiffViewActions {
  copyDiff?: () => void;
}

export function renderChatTurnDiffView(
  parent: HTMLElement,
  state: ChatTurnDiffViewState | null,
  actions: ChatTurnDiffViewActions = {},
  metadata: PersistedChatTurnDiffViewState | null = null,
): void {
  parent.addClass("codex-panel-chat-turn-diff");
  renderUiRoot(parent, <ChatTurnDiffView state={state} actions={actions} metadata={metadata} />);
}

function ChatTurnDiffView({
  state,
  actions,
  metadata,
}: {
  state: ChatTurnDiffViewState | null;
  actions: ChatTurnDiffViewActions;
  metadata: PersistedChatTurnDiffViewState | null;
}): UiNode {
  if (!state) {
    if (metadata) {
      return (
        <>
          <TurnDiffHeader state={metadata} copyDiff={null} />
          <div className="codex-panel-chat-turn-diff__empty">Turn diff is no longer available.</div>
        </>
      );
    }
    return <div className="codex-panel-chat-turn-diff__empty">No turn diff selected.</div>;
  }

  return (
    <>
      <TurnDiffHeader state={state} copyDiff={actions.copyDiff ?? null} />
      {state.files.length > 0 ? <ChangedFiles files={state.files} /> : null}
      <UnifiedDiffView diff={state.diff} className="codex-panel-chat-turn-diff__diff" />
    </>
  );
}

function TurnDiffHeader({
  state,
  copyDiff,
}: {
  state: PersistedChatTurnDiffViewState;
  copyDiff: ChatTurnDiffViewActions["copyDiff"] | null;
}): UiNode {
  return (
    <div className="codex-panel-chat-turn-diff__header">
      <div className="codex-panel-chat-turn-diff__title-block">
        <div className="codex-panel-chat-turn-diff__title">Turn diff</div>
        <div className="codex-panel-chat-turn-diff__meta">
          {shortThreadId(state.threadId)} / {shortThreadId(state.turnId)} ·{" "}
          {state.files.length === 1 ? "Edited 1 file" : `Edited ${String(state.files.length)} files`}
        </div>
      </div>
      {copyDiff ? (
        <IconButton icon="copy" label="Copy diff" className="clickable-icon codex-panel-chat-turn-diff__copy" onClick={copyDiff} />
      ) : null}
    </div>
  );
}

function ChangedFiles({ files }: { files: string[] }): UiNode {
  return (
    <details className="codex-panel-chat-turn-diff__files">
      <summary tabIndex={-1}>Changed files</summary>
      <ul>
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </details>
  );
}
