import { setIcon } from "obsidian";

import type { ThreadsRowModel } from "./state";

export interface ThreadsViewModel {
  status: string | null;
  loading: boolean;
  rows: ThreadsRowModel[];
}

export interface ThreadsViewActions {
  refresh: () => void;
  openNewPanel: () => void;
  openThread: (threadId: string) => void;
  startRename: (threadId: string, value: string) => void;
  updateRename: (threadId: string, value: string) => void;
  saveRename: (threadId: string, value: string) => void;
  cancelRename: (threadId: string) => void;
  archiveThread: (threadId: string) => void;
}

export function renderThreadsView(parent: HTMLElement, model: ThreadsViewModel, actions: ThreadsViewActions): void {
  parent.empty();
  parent.addClass("codex-panel-threads");

  const toolbar = parent.createDiv({ cls: "nav-header codex-panel-threads__toolbar" });
  const toolbarActions = toolbar.createDiv({ cls: "nav-buttons-container codex-panel-threads__toolbar-actions" });
  const openPanel = iconButton(toolbarActions, "message-square-plus", "Open new panel", "codex-panel-threads__toolbar-button");
  openPanel.onclick = () => {
    actions.openNewPanel();
  };
  const refresh = iconButton(toolbarActions, "refresh-cw", "Refresh threads", "codex-panel-threads__toolbar-button");
  refresh.onclick = () => {
    actions.refresh();
  };

  const list = parent.createDiv({ cls: "codex-panel-threads__list", attr: { role: "list" } });
  if (model.rows.length === 0) {
    list.createDiv({ cls: "codex-panel-threads__empty", text: model.status ?? (model.loading ? "Loading threads..." : "No threads") });
    return;
  }

  if (model.status) {
    list.createDiv({ cls: "codex-panel-threads__status", text: model.status });
  }

  for (const row of model.rows) {
    renderThreadRow(list, row, actions);
  }
}

function renderThreadRow(parent: HTMLElement, row: ThreadsRowModel, actions: ThreadsViewActions): void {
  const item = parent.createDiv({
    cls: "codex-panel-threads__row",
    attr: { role: "button", tabindex: "0", "aria-label": `Open thread: ${row.title}` },
  });
  if (row.live) item.addClass(`codex-panel-threads__row--${row.live.status}`);
  item.onclick = () => {
    actions.openThread(row.thread.id);
  };
  item.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    actions.openThread(row.thread.id);
  };

  if (row.rename.active) {
    renderRenameRow(item, row, actions);
    return;
  }

  const titleLine = item.createDiv({ cls: "codex-panel-threads__row-title-line" });
  titleLine.createSpan({ cls: "codex-panel-threads__row-title", text: row.title });

  const controls = item.createDiv({ cls: "codex-panel-threads__actions" });
  const rename = iconButton(controls, "pencil", "Rename thread", "codex-panel-threads__row-button");
  rename.onclick = (event) => {
    event.stopPropagation();
    actions.startRename(row.thread.id, row.thread.name ?? row.title);
  };
  const archive = iconButton(controls, "archive", "Archive thread", "codex-panel-threads__row-button");
  archive.onclick = (event) => {
    event.stopPropagation();
    actions.archiveThread(row.thread.id);
  };
}

function renderRenameRow(parent: HTMLElement, row: ThreadsRowModel, actions: ThreadsViewActions): void {
  parent.onclick = (event) => {
    event.stopPropagation();
  };
  const input = parent.createEl("input", {
    cls: "codex-panel-threads__rename-input",
    attr: { type: "text", value: row.rename.draft, "aria-label": "Thread name" },
  });
  input.oninput = () => {
    actions.updateRename(row.thread.id, input.value);
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter") {
      actions.saveRename(row.thread.id, input.value);
    }
    if (event.key === "Escape") {
      actions.cancelRename(row.thread.id);
    }
  };

  const save = iconButton(parent, "check", "Save thread name", "codex-panel-threads__row-button");
  save.onclick = () => {
    actions.saveRename(row.thread.id, input.value);
  };
  const cancel = iconButton(parent, "x", "Cancel rename", "codex-panel-threads__row-button");
  cancel.onclick = () => {
    actions.cancelRename(row.thread.id);
  };
  input.focus();
  input.select();
}

function iconButton(parent: HTMLElement, icon: string, label: string, className: string): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: `clickable-icon nav-action-button codex-panel-threads__icon-button ${className}`,
    attr: { "aria-label": label, type: "button" },
  });
  setIcon(button, icon);
  return button;
}
