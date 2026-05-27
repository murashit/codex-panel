import type { ExecutionState } from "../display/types";
import { applyExecutionStateClass } from "./execution-state";

export interface WorkMessageOptions {
  label: string;
  className: string;
  state?: ExecutionState;
  tone?: "warning";
}

export function createWorkMessageClassName(className: string, tone?: "warning"): string {
  return [
    "codex-panel__message",
    "codex-panel__message--tool",
    "codex-panel__work-message",
    className,
    tone ? `codex-panel__work-message--${tone}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function createWorkMessage(parent: HTMLElement, options: WorkMessageOptions): HTMLElement {
  const messageEl = parent.createDiv({
    cls: createWorkMessageClassName(options.className, options.tone),
  });
  applyExecutionStateClass(messageEl, options.state ?? null);
  messageEl.createDiv({ cls: "codex-panel__message-role", text: options.label });
  return messageEl;
}
