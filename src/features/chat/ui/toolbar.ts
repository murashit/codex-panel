import { setIcon } from "obsidian";

import type { EffectiveConfigSection, RateLimitSummary } from "../../../runtime/view";
import { createToolbarButton } from "../../../shared/ui/components";
import { renderEffectiveConfig } from "./config";

export type ToolbarPanelKind = "history" | "status" | "runtime";
export type ToolbarStatusState = "offline" | "connected" | "running";
export type ToolbarDiagnosticAlertLevel = "normal" | "warning" | "error";

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

export interface ToolbarDiagnosticSection {
  title: string;
  rows: ToolbarDiagnosticRow[];
}

export interface ToolbarViewModel {
  connected: boolean;
  status: string;
  statusState: ToolbarStatusState;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  runtimeOpen: boolean;
  planActive: boolean;
  autoReviewActive: boolean;
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
  diagnostics: ToolbarDiagnosticSection[];
  diagnosticAlertLevel: ToolbarDiagnosticAlertLevel;
}

export interface ToolbarActions {
  toggleHistory: () => void;
  toggleAutoReview: () => void;
  toggleStatusPanel: () => void;
  togglePlan: () => void;
  toggleFast: () => void;
  toggleRuntime: () => void;
  connect: () => void;
  refreshDiagnostics: () => void;
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
    autoReviewActive: model.autoReviewActive,
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
        `${thread.threadId}:${thread.title}:${String(thread.selected)}:${String(thread.disabled)}:${String(thread.canArchive)}:${thread.rename?.draft ?? ""}:${String(
          thread.rename?.generating ?? false,
        )}`,
    ),
    modelChoices: model.modelChoices.map(
      (choice) => `${choice.label}:${String(choice.selected)}:${String(choice.disabled)}:${choice.meta ?? ""}`,
    ),
    effortChoices: model.effortChoices.map(
      (choice) => `${choice.label}:${String(choice.selected)}:${String(choice.disabled)}:${choice.meta ?? ""}`,
    ),
    connectLabel: model.connectLabel,
    diagnostics: model.diagnostics.map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => `${row.label}:${row.value}:${row.level ?? "normal"}`),
    })),
    diagnosticAlertLevel: model.diagnosticAlertLevel,
  });
}

export function renderToolbar(toolbar: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  toolbar.empty();
  const primaryRow = toolbar.createDiv({ cls: "codex-panel__toolbar-primary" });
  renderHistoryButton(primaryRow, model, actions);
  renderAutoReviewButton(primaryRow, model, actions);
  const runtimeArea = primaryRow.createDiv({ cls: "codex-panel__runtime-area" });
  renderRuntimeStatus(runtimeArea, model, actions);
  renderContextMeter(primaryRow, model);
  renderStatusButton(primaryRow, model, actions);
  renderToolbarPanel(toolbar, model, actions);
}

function renderHistoryButton(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const button = createToolbarButton(parent, "history", "Threads");
  button.addClass("codex-panel__history-toggle");
  if (model.historyOpen) button.addClass("is-active");
  button.setAttr("aria-pressed", model.historyOpen ? "true" : "false");
  button.onclick = actions.toggleHistory;
}

function renderAutoReviewButton(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const button = createToolbarButton(parent, "shield", `Auto-review: ${model.autoReviewActive ? "on" : "off"}`);
  button.addClass("codex-panel__auto-review-toggle");
  if (model.autoReviewActive) button.addClass("is-active");
  button.setAttr("aria-pressed", model.autoReviewActive ? "true" : "false");
  button.onclick = actions.toggleAutoReview;
}

function renderStatusButton(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const alertClass = model.diagnosticAlertLevel === "normal" ? "" : ` codex-panel__status-dot--diagnostic-${model.diagnosticAlertLevel}`;
  const button = parent.createEl("button", {
    cls: `clickable-icon nav-action-button codex-panel-ui__toolbar-control codex-panel__status-dot codex-panel__status-dot--${model.statusState}${alertClass} ${model.statusPanelOpen ? "is-active" : ""}`,
    attr: {
      type: "button",
      "aria-label": statusButtonLabel(model),
      "aria-expanded": model.statusPanelOpen ? "true" : "false",
    },
  });
  if (model.diagnosticAlertLevel !== "normal") {
    button.createSpan({
      cls: `codex-panel__status-dot-diagnostic codex-panel__status-dot-diagnostic--${model.diagnosticAlertLevel}`,
      attr: { "aria-hidden": "true" },
    });
  }
  button.onclick = actions.toggleStatusPanel;
}

function statusButtonLabel(model: ToolbarViewModel): string {
  const status = model.status.trim() || (model.connected ? "Connected" : "Not connected");
  const connection = model.connected ? "connected" : "not connected";
  const normalizedStatus = status.toLowerCase().replace(/[.!…]+$/u, "");
  const parts = [`Status: ${status}`];
  if (normalizedStatus !== connection) parts.push(`Connection: ${connection}`);
  parts.push(`Diagnostics: ${model.diagnosticAlertLevel}`);
  return parts.join("; ");
}

function renderRuntimeStatus(parent: HTMLElement, model: ToolbarViewModel, actions: ToolbarActions): void {
  const row = parent.createDiv({ cls: "codex-panel__runtime-strip" });
  renderRuntimeIcon(row, "list-checks", `Plan mode: ${model.planActive ? "on" : "off"}`, model.planActive, actions.togglePlan);
  renderRuntimeIcon(row, "zap", `Fast mode: ${model.fastActive ? "on" : "off"}`, model.fastActive, actions.toggleFast);
  renderRuntimeModelControl(row, model, actions);
}

function renderRuntimeIcon(parent: HTMLElement, icon: string, label: string, active: boolean, onClick: () => void): void {
  const button = parent.createEl("button", {
    cls: `clickable-icon nav-action-button codex-panel-ui__toolbar-control codex-panel__runtime-icon ${active ? "is-active" : ""}`,
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
    "codex-panel-ui__toolbar-control",
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
      style: `width: ${String(model.context.percent ?? 0)}%`,
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
  createToolbarPanelRow(statusItems, model.connectLabel, { onClick: actions.connect, className: "codex-panel__status-panel-item" });
  createToolbarPanelRow(statusItems, "Refresh diagnostics", {
    onClick: actions.refreshDiagnostics,
    className: "codex-panel__status-panel-item",
  });
  createToolbarPanelRow(statusItems, "Refresh thread list", {
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
  section.createDiv({ cls: "codex-panel__limit-panel-title", text: "Usage limit" });
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
      attr: { style: `width: ${String(row.percent)}%` },
    });
    item.createDiv({ cls: "codex-panel__limit-panel-reset", text: row.resetLabel ?? "" });
  }
}

function renderConnectionDiagnostics(parent: HTMLElement, sections: ToolbarDiagnosticSection[]): void {
  const diagnostics = parent.createDiv({ cls: "codex-panel__connection-diagnostics" });
  diagnostics.createDiv({ cls: "codex-panel__connection-diagnostics-title", text: "Connection" });
  for (const section of sections) {
    diagnostics.createDiv({ cls: "codex-panel__connection-diagnostics-section", text: section.title });
    const list = diagnostics.createEl("dl", { cls: "codex-panel__connection-diagnostics-list" });
    for (const row of section.rows) {
      const item = list.createDiv({
        cls: `codex-panel__connection-diagnostics-row codex-panel__connection-diagnostics-row--${row.level ?? "normal"}`,
      });
      item.createEl("dt", { text: row.label });
      item.createEl("dd", { text: row.value });
    }
  }
}

function renderRuntimePicker(parent: HTMLElement, model: ToolbarViewModel): void {
  const picker = parent.createDiv({ cls: "codex-panel__runtime-picker", attr: { role: "listbox" } });
  picker.createDiv({ cls: "codex-panel__runtime-picker-label", text: "Reasoning effort" });
  for (const choice of model.effortChoices) {
    createToolbarPanelRow(picker, choice.label, { ...choice, className: "codex-panel__runtime-choice" });
  }
  picker.createDiv({ cls: "codex-panel__runtime-picker-label", text: "Model" });
  for (const choice of model.modelChoices) {
    createToolbarPanelRow(picker, choice.label, { ...choice, className: "codex-panel__runtime-choice" });
  }
}

function renderThreadList(parent: HTMLElement, threads: ToolbarThreadRow[], actions: ToolbarActions): void {
  const threadsEl = parent.createDiv({ cls: "codex-panel__threads" });
  if (threads.length === 0) {
    createToolbarPanelRow(threadsEl, "No threads", { disabled: true, className: "codex-panel__thread codex-panel__thread--empty" });
    return;
  }

  for (const thread of threads) {
    const row = threadsEl.createDiv({
      cls: ["codex-panel__thread-row", thread.rename ? "codex-panel__thread-row--renaming" : ""].filter(Boolean).join(" "),
    });
    if (thread.rename) {
      renderThreadRenameRow(row, thread, actions);
      continue;
    }

    createToolbarPanelRow(row, thread.title, {
      selected: thread.selected,
      disabled: thread.disabled,
      title: `${thread.title}\n${thread.threadId}`,
      className: "codex-panel__thread",
      onClick: () => {
        actions.resumeThread(thread.threadId);
      },
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
  let input!: HTMLInputElement;
  createToolbarPanelRow(parent, thread.title, {
    className: "codex-panel__thread codex-panel__thread-rename",
    interactive: false,
    title: `Rename ${thread.title}`,
    renderContent: (row) => {
      const field = row.createDiv({ cls: "codex-panel__thread-rename-field" });
      input = field.createEl("input", {
        cls: "codex-panel__thread-rename-input",
        attr: {
          type: "text",
          value: thread.rename?.draft ?? thread.title,
          "aria-label": `Rename ${thread.title}`,
        },
      });
      input.oninput = () => {
        actions.updateRenameDraft(thread.threadId, input.value);
      };
      input.onkeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (!event.isComposing && !(thread.rename?.generating ?? false)) actions.saveRenameThread(thread.threadId, input.value);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          actions.cancelRenameThread(thread.threadId);
        }
      };
    },
  });
  input.win.setTimeout(() => {
    if (input.ownerDocument.activeElement !== input) {
      input.focus();
      input.select();
    }
  }, 0);

  const save = createToolbarButton(parent, "check", "Save thread name");
  save.addClass("codex-panel__thread-action");
  save.disabled = thread.rename?.generating ?? false;
  save.onclick = (event) => {
    event.stopPropagation();
    actions.saveRenameThread(thread.threadId, input.value);
  };

  const cancel = createToolbarButton(parent, "x", "Cancel rename");
  cancel.addClass("codex-panel__thread-action");
  cancel.onclick = (event) => {
    event.stopPropagation();
    actions.cancelRenameThread(thread.threadId);
  };

  const autoName = createToolbarButton(parent, thread.rename?.generating ? "loader" : "sparkles", "Auto-name thread");
  autoName.addClass("codex-panel__thread-action");
  autoName.disabled = thread.rename?.generating ?? false;
  autoName.onclick = (event) => {
    event.stopPropagation();
    actions.autoNameThread(thread.threadId);
  };
}

function createToolbarPanelRow(
  parent: HTMLElement,
  label: string,
  options: {
    selected?: boolean;
    disabled?: boolean;
    title?: string;
    meta?: string;
    className?: string;
    interactive?: boolean;
    renderContent?: (parent: HTMLElement) => void;
    onClick?: () => void;
  } = {},
): HTMLElement {
  const selected = Boolean(options.selected);
  const disabled = Boolean(options.disabled);
  const interactive = options.interactive ?? true;
  const attr: Record<string, string> = { title: options.title ?? label };
  if (interactive) {
    attr["role"] = "button";
    attr["tabindex"] = disabled ? "-1" : "0";
    attr["aria-disabled"] = disabled ? "true" : "false";
    attr["aria-selected"] = selected ? "true" : "false";
  }
  const item = parent.createDiv({
    cls: ["codex-panel__toolbar-panel-item", options.className ?? "", selected ? "is-checked" : "", disabled ? "is-disabled" : ""]
      .filter(Boolean)
      .join(" "),
    attr,
  });
  if (interactive) {
    item.onclick = () => {
      if (!disabled) options.onClick?.();
    };
    item.onkeydown = (event) => {
      if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      options.onClick?.();
    };
  }
  const check = item.createSpan({ cls: "codex-panel__toolbar-panel-check" });
  if (selected) setIcon(check, "check");
  if (options.renderContent) {
    options.renderContent(item);
    return item;
  }
  item.createSpan({ cls: "codex-panel__toolbar-panel-label", text: label });
  if (options.meta) item.createSpan({ cls: "codex-panel__toolbar-panel-meta", text: options.meta });
  return item;
}
