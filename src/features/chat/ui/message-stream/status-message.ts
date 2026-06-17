export function createStatusMessageClassName(className: string, tone?: "warning"): string {
  return [
    "codex-panel__message",
    "codex-panel__message--tool",
    "codex-panel__status-message",
    className,
    tone ? `codex-panel__status-message--${tone}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
