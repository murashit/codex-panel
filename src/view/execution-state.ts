import type { ExecutionState } from "../display/types";

export function applyExecutionStateClass(parent: HTMLElement, state: ExecutionState): void {
  if (!state) return;
  parent.addClass("codex-panel__execution");
  parent.addClass(`codex-panel__execution--${state}`);
}
