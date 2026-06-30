export interface McpElicitationValidityMessage {
  fieldId: string;
  message: string;
}

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

export function applyMcpElicitationFormValidity(form: HTMLFormElement | null, messages: readonly McpElicitationValidityMessage[]): boolean {
  if (!form) return true;
  clearMcpElicitationCustomValidity(form);
  for (const { fieldId, message } of messages) {
    const input = Array.from(form.querySelectorAll<HTMLInputElement>("input[data-mcp-elicitation-field]")).find(
      (candidate) => candidate.dataset["mcpElicitationField"] === fieldId,
    );
    input?.setCustomValidity(message);
  }
  return form.reportValidity();
}

function clearMcpElicitationCustomValidity(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>(".codex-panel__mcp-elicitation-checkbox").forEach((input) => {
    input.setCustomValidity("");
  });
}
