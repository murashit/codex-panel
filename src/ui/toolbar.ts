import { setIcon } from "obsidian";

import type { EffectiveConfigSection, RateLimitSummary } from "../runtime/view";
import { createToolbarButton } from "./components";
import { renderEffectiveConfig } from "./config";

export type ToolbarPanelKind = "history" | "status" | "runtime";
export type ToolbarStatusState = "offline" | "connected" | "running";

export interface ToolbarChoice {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  meta?: string;
  onClick: () => void;
}

export interface ToolbarThreadRow {
  title: string;
  threadId: string;
  selected: boolean;
  disabled: boolean;
  canArchive: boolean;
  rename: {
    draft: string;
    generating: boolean;
  } | null;
}

export interface ToolbarDiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export interface ToolbarViewModel {
  connected: boolean;
  status: string;
  statusState: ToolbarStatusState;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  runtimeOpen: boolean;
  planActive: boolean;
  fastActive: boolean;
  runtimeSummary: string;
  runtimeTitle: string;
  runtimeAriaLabel: string;
  runtimeEmphasized: boolean;
  context: { level: "ok" | "warn" | "danger"; title: string; label: string; percent: number | null } | null;
  rateLimit: RateLimitSummary | null;
  configSections: EffectiveConfigSection[];
  openPanel: ToolbarPanelKind | null;
  threads: ToolbarThreadRow[];
  modelChoices: ToolbarChoice[];
  effortChoices: ToolbarChoice[];
  connectLabel: string;
  diagnostics: ToolbarDiagnosticRow[];
}

export interface ToolbarActions {
  toggleHistory: () => void;
  toggleStatusPanel: () => void;
  togglePlan: () => void;
  toggleFast: () => void;
  toggleRuntime: () => void;
  connect: () => void;
  refreshThreads: () => void;
  resumeThread: (threadId: string) => void;
  archiveThread: (threadId: string) => void;
  startRenameThread: (threadId: string) => void;
  updateRenameDraft: (threadId: string, value: string) => void;
  saveRenameThread: (threadId: string, value: string) => void;
  cancelRenameThread: (threadId: string) => void;
  autoNameThread: (threadId: string) => void;
}

export function toolbarSignature(model: ToolbarViewModel): string {
  return JSON.stringify({
    connected: model.connected,
    status: model.status,
    statusState: model.statusState,
    historyOpen: model.historyOpen,
    statusPanelOpen: model.statusPanelOpen,
    runtimeOpen: model.runtimeOpen,
    planActive: model.planActive,
    fastActive: model.fastActive,
    runtimeSummary: model.runtimeSummary,
    runtimeTitle: model.runtimeTitle,
    runtimeEmphasized: model.runtimeEmphasized,
    context: model.context,
    rateLimit: model.rateLimit,
    configSections: model.configSections.map(
      (section) => `${section.title}:${section.rows.map((row) => `${row.key}=${row.value}`).join(",")}`,
    ),
    openPanel: model.openPanel,
    threads: model.threads.map(
      (thread) =>
        `${thread.threadId}:${thread.title}:${thread.selected}:${thread.disabled}:${thread.canArchive}:${thread.rename?.draft ?? ""}:${
          thread.rename?.generating ?? false
        }`,
    ),
    modelChoices: model.modelChoices.map((choice) => `${choice.label}:${choice.selected}:${choice.disabled}:${choice.meta ?? ""}`),
    effortChoices: model.effortChoices.map((choice) => `${choice.label}:${choice.selected}:${choice.disabled}:${choice.meta ?? ""}`),
    connectLabel: model.connectLabel,
    diagnostics: model.diagnostics.map((row) => `${row.label}:${row.value}:${row.level ?? "normal"}`),
  });
}

export function renderToolbar(toolbar: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  toolbar.empty();
  const primaryRow = toolbar.createDiv({ cls: "codex-panel__toolbar-primary" });
  renderHistoryButton(primaryRow, model, actions);
  const runtimeArea = primaryRow.createDiv({ cls: "codex-panel__runtime-area" });
  renderRuntimeStatus(runtimeArea, model, actions);
  renderContextMeter(primaryRow, model);
  renderStatusButton(primaryRow, model, actions);
  renderToolbarPanel(toolbar, model, actions);
}

function renderHistoryButton(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const history = parent.createDiv({ cls: "codex-panel__toolbar-control codex-panel__history-menu" });
  const button = createToolbarButton(history, "history", "Chat history");
  button.addClass("codex-panel__history-toggle");
  if (model.historyOpen) button.addClass("is-active");
  button.setAttr("aria-pressed", model.historyOpen ? "true" : "false");
  button.onclick = actions.toggleHistory;
}

function renderStatusButton(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const label = `Status: ${model.status}; ${model.connected ? "connected" : "not connected"}`;
  const button = parent.createEl("button", {
    cls: `clickable-icon nav-action-button codex-panel__top-control codex-panel__status-dot codex-panel__status-dot--${model.statusState} ${model.statusPanelOpen ? "is-active" : ""}`,
    attr: {
      type: "button",
      "aria-label": label,
      "aria-expanded": model.statusPanelOpen ? "true" : "false",
    },
  });
  button.onclick = actions.toggleStatusPanel;
}

function renderRuntimeStatus(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const row = parent.createDiv({ cls: "codex-panel__runtime-strip" });
  renderRuntimeIcon(row, "list-checks", `Plan mode: ${model.planActive ? "on" : "off"}`, model.planActive, actions.togglePlan);
  renderRuntimeIcon(row, "zap", `Fast mode: ${model.fastActive ? "on" : "off"}`, model.fastActive, actions.toggleFast);
  renderRuntimeModelControl(row, model, actions);
}

function renderRuntimeIcon(parent: HTMLElement, icon: string, label: string, active: boolean, onClick: () => void): void {
  const button = parent.createEl("button", {
    cls: `clickable-icon nav-action-button codex-panel__top-control codex-panel__runtime-icon ${active ? "is-active" : ""}`,
    attr: {
      type: "button",
      "aria-label": label,
      "aria-pressed": active ? "true" : "false",
    },
  });
  setIcon(button, icon);
  button.onclick = onClick;
}

function renderRuntimeModelControl(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const cls = [
    "clickable-icon",
    "codex-panel__runtime-model",
    "codex-panel__top-control",
    model.runtimeEmphasized ? "is-emphasized" : "",
    model.runtimeOpen ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const button = parent.createEl("button", {
    cls,
    attr: {
      type: "button",
      "aria-label": model.runtimeAriaLabel,
      "aria-expanded": model.runtimeOpen ? "true" : "false",
    },
  });
  button.createSpan({ cls: "codex-panel__runtime-model-value", text: model.runtimeSummary });
  button.onclick = actions.toggleRuntime;
}

function renderContextMeter(parent: HTMLElement, model: ToolbarViewModel): void {
  if (!model.context) return;

  const context = parent.createDiv({
    cls: `codex-panel__meter-compact codex-panel__context-compact codex-panel__meter-compact--${model.context.level}`,
  });
  context.title = model.context.title;
  context.createSpan({ cls: "codex-panel__meter-compact-label codex-panel__context-compact-label", text: model.context.label });
  const bar = context.createSpan({ cls: "codex-panel__meter-compact-bar codex-panel__context-compact-bar" });
  bar.createSpan({
    cls: "codex-panel__meter-compact-fill codex-panel__context-compact-fill",
    attr: {
      style: `width: ${model.context.percent ?? 0}%`,
    },
  });
}

function renderToolbarPanel(toolbar: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  if (!model.openPanel) return;

  const panel = toolbar.createDiv({ cls: `codex-panel__toolbar-panel codex-panel__toolbar-panel--${model.openPanel}` });
  if (model.openPanel === "history") {
    renderThreadList(panel, model.threads, actions);
  } else if (model.openPanel === "runtime") {
    renderRuntimePicker(panel, model);
  } else {
    renderStatusPanel(panel, model, actions);
  }
}

function renderStatusPanel(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const statusItems = parent.createDiv({ cls: "codex-panel__status-panel-items", attr: { role: "menu" } });
  createToolbarPanelItem(statusItems, model.connectLabel, { onClick: actions.connect, className: "codex-panel__status-panel-item" });
  createToolbarPanelItem(statusItems, "Refresh thread list", {
    onClick: actions.refreshThreads,
    className: "codex-panel__status-panel-item",
  });
  renderRateLimitPanel(parent, model.rateLimit);
  renderConnectionDiagnostics(parent, model.diagnostics);
  renderEffectiveConfig(parent, model.configSections);
}

function renderRateLimitPanel(parent: HTMLElement, rateLimit: RateLimitSummary | null): void {
  if (!rateLimit) return;

  const section = parent.createDiv({ cls: `codex-panel__limit-panel codex-panel__limit-panel--${rateLimit.level}` });
  section.createDiv({ cls: "codex-panel__limit-panel-title", text: "Usage Limit" });
  const list = section.createDiv({ cls: "codex-panel__limit-panel-list" });
  for (const row of rateLimit.rows) {
    const item = list.createDiv({
      cls: `codex-panel__limit-panel-row codex-panel__limit-panel-row--${row.level}`,
      attr: { title: row.title },
    });
    item.createDiv({ cls: "codex-panel__limit-panel-label", text: row.label });
    item.createDiv({ cls: "codex-panel__limit-panel-value", text: row.value });
    const meter = item.createDiv({ cls: "codex-panel__limit-panel-meter" });
    meter.createDiv({
      cls: "codex-panel__limit-panel-fill",
      attr: { style: `width: ${row.percent}%` },
    });
    item.createDiv({ cls: "codex-panel__limit-panel-reset", text: row.resetLabel ?? "" });
  }
}

function renderConnectionDiagnostics(parent: HTMLElement, rows: ToolbarDiagnosticRow[]): void {
  const diagnostics = parent.createDiv({ cls: "codex-panel__connection-diagnostics" });
  diagnostics.createDiv({ cls: "codex-panel__connection-diagnostics-title", text: "Connection diagnostics" });
  const list = diagnostics.createEl("dl", { cls: "codex-panel__connection-diagnostics-list" });
  for (const row of rows) {
    const item = list.createDiv({
      cls: `codex-panel__connection-diagnostics-row codex-panel__connection-diagnostics-row--${row.level ?? "normal"}`,
    });
    item.createEl("dt", { text: row.label });
    item.createEl("dd", { text: row.value });
  }
}

function renderRuntimePicker(parent: HTMLElement, model: ToolbarViewModel): void {
  const picker = parent.createDiv({ cls: "codex-panel__runtime-picker", attr: { role: "listbox", "aria-label": "Runtime settings" } });
  picker.createDiv({ cls: "codex-panel__runtime-picker-label", text: "Model" });
  for (const choice of model.modelChoices) {
    createToolbarPanelItem(picker, choice.label, { ...choice, className: "codex-panel__runtime-choice" });
  }
  picker.createDiv({ cls: "codex-panel__runtime-picker-label", text: "Effort" });
  for (const choice of model.effortChoices) {
    createToolbarPanelItem(picker, choice.label, { ...choice, className: "codex-panel__runtime-choice" });
  }
}

function renderThreadList(parent: HTMLElement, threads: ToolbarThreadRow[], actions: ToolbarActions): void {
  const threadsEl = parent.createDiv({ cls: "codex-panel__threads", attr: { role: "listbox", "aria-label": "Chat history" } });
  if (threads.length === 0) {
    const empty = threadsEl.createDiv({
      cls: "menu-item codex-panel__toolbar-panel-item codex-panel__thread codex-panel__thread--empty is-disabled",
    });
    empty.createSpan({ cls: "menu-item-icon codex-panel__toolbar-panel-check" });
    empty.createSpan({ cls: "menu-item-title codex-panel__toolbar-panel-label", text: "No threads" });
    return;
  }

  for (const thread of threads) {
    const row = threadsEl.createDiv({
      cls: `codex-panel__thread-row ${thread.rename ? "codex-panel__thread-row--renaming" : ""}`,
    });
    if (thread.rename) {
      renderThreadRenameRow(row, thread, actions);
      continue;
    }

    createToolbarPanelItem(row, thread.title, {
      selected: thread.selected,
      disabled: thread.disabled,
      title: `${thread.title}\n${thread.threadId}`,
      className: "codex-panel__thread",
      onClick: () => actions.resumeThread(thread.threadId),
    });

    const rename = createToolbarButton(row, "pencil", "Rename thread");
    rename.addClass("codex-panel__thread-action");
    rename.disabled = thread.disabled;
    rename.onclick = (event) => {
      event.stopPropagation();
      actions.startRenameThread(thread.threadId);
    };

    if (thread.canArchive) {
      const action = createToolbarButton(row, "archive", "Archive thread");
      action.addClass("codex-panel__thread-action");
      action.disabled = thread.disabled;
      action.onclick = (event) => {
        event.stopPropagation();
        actions.archiveThread(thread.threadId);
      };
    }
  }
}

function renderThreadRenameRow(parent: HTMLElement, thread: ToolbarThreadRow, actions: ToolbarActions): void {
  const form = parent.createDiv({ cls: "codex-panel__thread-rename" });
  const input = form.createEl("input", {
    cls: "codex-panel__thread-rename-input",
    attr: {
      type: "text",
      value: thread.rename?.draft ?? thread.title,
      "aria-label": `Rename ${thread.title}`,
    },
  });
  input.oninput = () => actions.updateRenameDraft(thread.threadId, input.value);
  input.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!thread.rename?.generating) actions.saveRenameThread(thread.threadId, input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      actions.cancelRenameThread(thread.threadId);
    }
  };
  window.setTimeout(() => {
    if (input.ownerDocument.activeElement !== input) {
      input.focus();
      input.select();
    }
  }, 0);

  const save = createToolbarButton(form, "check", "Save thread name");
  save.addClass("codex-panel__thread-action");
  save.disabled = thread.rename?.generating ?? false;
  save.onclick = (event) => {
    event.stopPropagation();
    actions.saveRenameThread(thread.threadId, input.value);
  };

  const cancel = createToolbarButton(form, "x", "Cancel rename");
  cancel.addClass("codex-panel__thread-action");
  cancel.onclick = (event) => {
    event.stopPropagation();
    actions.cancelRenameThread(thread.threadId);
  };

  const autoName = createToolbarButton(form, thread.rename?.generating ? "loader" : "sparkles", "Auto-name thread");
  autoName.addClass("codex-panel__thread-action");
  autoName.disabled = thread.rename?.generating ?? false;
  autoName.onclick = (event) => {
    event.stopPropagation();
    actions.autoNameThread(thread.threadId);
  };
}

function createToolbarPanelItem(
  parent: HTMLElement,
  label: string,
  options: {
    selected?: boolean;
    disabled?: boolean;
    title?: string;
    meta?: string;
    className?: string;
    onClick?: () => void;
  } = {},
): HTMLElement {
  const selected = Boolean(options.selected);
  const disabled = Boolean(options.disabled);
  const item = parent.createEl("button", {
    cls: [
      "menu-item",
      "tappable",
      "codex-panel__toolbar-panel-item",
      options.className ?? "",
      selected ? "selected is-selected" : "",
      disabled ? "is-disabled" : "",
    ]
      .filter(Boolean)
      .join(" "),
    attr: {
      type: "button",
      title: options.title ?? label,
      "aria-selected": selected ? "true" : "false",
    },
  });
  item.disabled = disabled;
  item.onclick = () => {
    if (!disabled) options.onClick?.();
  };
  const check = item.createSpan({ cls: "menu-item-icon codex-panel__toolbar-panel-check" });
  if (selected) setIcon(check, "check");
  item.createSpan({ cls: "menu-item-title codex-panel__toolbar-panel-label", text: label });
  if (options.meta) item.createSpan({ cls: "codex-panel__toolbar-panel-meta", text: options.meta });
  return item;
}
