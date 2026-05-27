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
