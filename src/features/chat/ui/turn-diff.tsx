import { useLayoutEffect, useRef, type ReactNode } from "react";

import { renderDisplayDiffLines } from "../../../shared/diff/render";
import { displayDiffLines } from "../../../shared/diff/unified";
import { IconButton } from "../../../shared/ui/react-components";
import { renderReactRoot } from "../../../shared/ui/react-root";
import { shortThreadId } from "../../../utils";

export { displayDiffLines } from "../../../shared/diff/unified";

export interface ChatTurnDiffViewState {
  threadId: string;
  turnId: string;
  cwd: string | null;
  files: string[];
  diff: string;
}

export type PersistedChatTurnDiffViewState = Omit<ChatTurnDiffViewState, "diff">;

export interface ChatTurnDiffViewActions {
  copyDiff?: () => void;
}

export function persistedChatTurnDiffViewState(state: ChatTurnDiffViewState): PersistedChatTurnDiffViewState {
  return {
    threadId: state.threadId,
    turnId: state.turnId,
    cwd: state.cwd,
    files: [...state.files],
  };
}

export function isPersistedChatTurnDiffViewState(value: unknown): value is PersistedChatTurnDiffViewState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedChatTurnDiffViewState>;
  return (
    typeof record.threadId === "string" &&
    typeof record.turnId === "string" &&
    (typeof record.cwd === "string" || record.cwd === null) &&
    Array.isArray(record.files) &&
    record.files.every((file) => typeof file === "string")
  );
}

export function renderChatTurnDiffView(
  parent: HTMLElement,
  state: ChatTurnDiffViewState | null,
  actions: ChatTurnDiffViewActions = {},
  metadata: PersistedChatTurnDiffViewState | null = null,
): void {
  parent.addClass("codex-panel-chat-turn-diff");
  renderReactRoot(parent, <ChatTurnDiffView state={state} actions={actions} metadata={metadata} />);
}

function ChatTurnDiffView({
  state,
  actions,
  metadata,
}: {
  state: ChatTurnDiffViewState | null;
  actions: ChatTurnDiffViewActions;
  metadata: PersistedChatTurnDiffViewState | null;
}): ReactNode {
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
      <UnifiedDiff diff={state.diff} />
    </>
  );
}

function TurnDiffHeader({
  state,
  copyDiff,
}: {
  state: PersistedChatTurnDiffViewState;
  copyDiff: ChatTurnDiffViewActions["copyDiff"] | null;
}): ReactNode {
  return (
    <div className="codex-panel-chat-turn-diff__header">
      <div className="codex-panel-chat-turn-diff__title-block">
        <div className="codex-panel-chat-turn-diff__title">Turn diff</div>
        <div className="codex-panel-chat-turn-diff__meta">
          {shortThreadId(state.threadId)} / {shortThreadId(state.turnId)} · {fileCountLabel(state.files)}
        </div>
      </div>
      {copyDiff ? (
        <IconButton icon="copy" label="Copy diff" className="clickable-icon codex-panel-chat-turn-diff__copy" onClick={copyDiff} />
      ) : null}
    </div>
  );
}

function ChangedFiles({ files }: { files: string[] }): ReactNode {
  return (
    <details className="codex-panel-chat-turn-diff__files">
      <summary>Changed files</summary>
      <ul>
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </details>
  );
}

function UnifiedDiff({ diff }: { diff: string }): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    renderUnifiedDiff(element, diff);
  }, [diff]);
  return <div ref={ref} />;
}

export function renderUnifiedDiff(parent: HTMLElement, diff: string): HTMLElement {
  return renderDisplayDiffLines(parent, displayDiffLines(diff), { className: "codex-panel-chat-turn-diff__diff" });
}

function fileCountLabel(files: string[]): string {
  return files.length === 1 ? "Edited 1 file" : `Edited ${String(files.length)} files`;
}
