import { shortThreadId } from "../utils";
import { createIconButton } from "./components";

export interface TurnDiffViewState {
  threadId: string;
  turnId: string;
  cwd: string | null;
  files: string[];
  diff: string;
}

export type PersistedTurnDiffViewState = Omit<TurnDiffViewState, "diff">;

export interface TurnDiffViewActions {
  copyDiff?: () => void;
}

export function persistedTurnDiffViewState(state: TurnDiffViewState): PersistedTurnDiffViewState {
  return {
    threadId: state.threadId,
    turnId: state.turnId,
    cwd: state.cwd,
    files: [...state.files],
  };
}

export function isPersistedTurnDiffViewState(value: unknown): value is PersistedTurnDiffViewState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedTurnDiffViewState>;
  return (
    typeof record.threadId === "string" &&
    typeof record.turnId === "string" &&
    (typeof record.cwd === "string" || record.cwd === null) &&
    Array.isArray(record.files) &&
    record.files.every((file) => typeof file === "string")
  );
}

export function renderTurnDiffView(
  parent: HTMLElement,
  state: TurnDiffViewState | null,
  actions: TurnDiffViewActions = {},
  metadata: PersistedTurnDiffViewState | null = null,
): void {
  parent.empty();
  parent.addClass("codex-panel-turn-diff");
  if (!state) {
    if (metadata) {
      renderTurnDiffHeader(parent, metadata, null);
      parent.createDiv({ cls: "codex-panel-turn-diff__empty", text: "Turn diff is no longer available." });
    } else {
      parent.createDiv({ cls: "codex-panel-turn-diff__empty", text: "No turn diff selected." });
    }
    return;
  }

  renderTurnDiffHeader(parent, state, actions.copyDiff ?? null);

  if (state.files.length > 0) {
    const files = parent.createEl("details", { cls: "codex-panel-turn-diff__files" });
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
  state: PersistedTurnDiffViewState,
  copyDiff: TurnDiffViewActions["copyDiff"] | null,
): void {
  const header = parent.createDiv({ cls: "codex-panel-turn-diff__header" });
  const titleBlock = header.createDiv({ cls: "codex-panel-turn-diff__title-block" });
  titleBlock.createDiv({ cls: "codex-panel-turn-diff__title", text: "Turn diff" });
  titleBlock.createDiv({
    cls: "codex-panel-turn-diff__meta",
    text: `${shortThreadId(state.threadId)} / ${shortThreadId(state.turnId)} · ${fileCountLabel(state.files)}`,
    attr: { title: `Thread ${state.threadId}\nTurn ${state.turnId}${state.cwd ? `\n${state.cwd}` : ""}` },
  });
  if (copyDiff) {
    const copyButton = createIconButton(header, "copy", "Copy diff", "codex-panel-turn-diff__copy");
    copyButton.onclick = copyDiff;
  }
}

export function renderUnifiedDiff(parent: HTMLElement, diff: string): HTMLElement {
  const pre = parent.createEl("pre", { cls: "codex-panel__diff codex-panel-turn-diff__diff" });
  for (const line of displayDiffLines(diff)) {
    const lineClass = diffLineClass(line);
    pre.createEl("span", {
      cls: `codex-panel__diff-line codex-panel__diff-line--${lineClass}`,
      text: displayDiffLineText(line.text, lineClass),
    });
  }
  return pre;
}

interface DisplayDiffLine {
  text: string;
  kind?: "file";
}

export function displayDiffLines(diff: string): DisplayDiffLine[] {
  const displayLines: DisplayDiffLine[] = [];
  let inFileHeader = false;
  for (const line of diff.split("\n")) {
    const file = filePathFromGitDiffHeader(line);
    if (file) {
      displayLines.push({ text: file, kind: "file" });
      inFileHeader = true;
      continue;
    }
    if (line.startsWith("@@")) inFileHeader = false;
    if (inFileHeader && (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ "))) continue;
    displayLines.push({ text: line });
  }
  return displayLines;
}

function fileCountLabel(files: string[]): string {
  return files.length === 1 ? "Edited 1 file" : `Edited ${String(files.length)} files`;
}

function filePathFromGitDiffHeader(line: string): string | null {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match) return null;
  return match[2];
}

export type DiffLineClass = "added" | "removed" | "hunk" | "context" | "file";

export function diffLineClass(line: DisplayDiffLine): DiffLineClass {
  if (line.kind === "file") return "file";
  return diffLineClassFromText(line.text);
}

export function diffLineClassFromText(text: string): Exclude<DiffLineClass, "file"> {
  if (text.startsWith("+") && !text.startsWith("+++")) return "added";
  if (text.startsWith("-") && !text.startsWith("---")) return "removed";
  if (text.startsWith("@@")) return "hunk";
  return "context";
}

export function displayDiffLineText(text: string, lineClass: DiffLineClass): string {
  const displayText = lineClass === "added" || lineClass === "removed" ? text.slice(1) : text;
  return displayText || " ";
}
