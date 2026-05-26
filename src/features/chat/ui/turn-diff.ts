import { displayDiffLines, diffLineClass, displayDiffLineText } from "../../../shared/diff/unified";
import { createIconButton } from "../../../shared/ui/components";
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
  parent.empty();
  parent.addClass("codex-panel-chat-turn-diff");
  if (!state) {
    if (metadata) {
      renderTurnDiffHeader(parent, metadata, null);
      parent.createDiv({ cls: "codex-panel-chat-turn-diff__empty", text: "Turn diff is no longer available." });
    } else {
      parent.createDiv({ cls: "codex-panel-chat-turn-diff__empty", text: "No turn diff selected." });
    }
    return;
  }

  renderTurnDiffHeader(parent, state, actions.copyDiff ?? null);

  if (state.files.length > 0) {
    const files = parent.createEl("details", { cls: "codex-panel-chat-turn-diff__files" });
    files.createEl("summary", { text: "Changed files" });
    const list = files.createEl("ul");
    for (const file of state.files) {
      list.createEl("li", { text: file });
    }
  }

  renderUnifiedDiff(parent, state.diff);
}

function renderTurnDiffHeader(
  parent: HTMLElement,
  state: PersistedChatTurnDiffViewState,
  copyDiff: ChatTurnDiffViewActions["copyDiff"] | null,
): void {
  const header = parent.createDiv({ cls: "codex-panel-chat-turn-diff__header" });
  const titleBlock = header.createDiv({ cls: "codex-panel-chat-turn-diff__title-block" });
  titleBlock.createDiv({ cls: "codex-panel-chat-turn-diff__title", text: "Turn diff" });
  titleBlock.createDiv({
    cls: "codex-panel-chat-turn-diff__meta",
    text: `${shortThreadId(state.threadId)} / ${shortThreadId(state.turnId)} · ${fileCountLabel(state.files)}`,
  });
  if (copyDiff) {
    const copyButton = createIconButton(header, "copy", "Copy diff", "codex-panel-chat-turn-diff__copy");
    copyButton.onclick = copyDiff;
  }
}

export function renderUnifiedDiff(parent: HTMLElement, diff: string): HTMLElement {
  const pre = parent.createEl("pre", { cls: "codex-panel-diff codex-panel-chat-turn-diff__diff" });
  for (const line of displayDiffLines(diff)) {
    const lineClass = diffLineClass(line);
    pre.createEl("span", {
      cls: `codex-panel-diff__line codex-panel-diff__line--${lineClass}`,
      text: displayDiffLineText(line.text, lineClass),
    });
  }
  return pre;
}

function fileCountLabel(files: string[]): string {
  return files.length === 1 ? "Edited 1 file" : `Edited ${String(files.length)} files`;
}
