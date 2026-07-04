export function focusPendingRequestControl(container: HTMLElement | null): void {
  if (!container) return;
  for (const selector of [
    ".codex-panel__user-input-radio:checked",
    ".codex-panel__user-input-text",
    ".codex-panel__mcp-elicitation-input",
    ".codex-panel__mcp-elicitation-checkbox",
    ".codex-panel__mcp-elicitation-radio:checked",
    ".codex-panel__mcp-elicitation-radio",
    ".codex-panel__user-input-radio",
    ".codex-panel__pending-request-button.mod-cta",
    ".codex-panel__pending-request-button",
  ]) {
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) continue;
    target.focus({ preventScroll: true });
    return;
  }
}
