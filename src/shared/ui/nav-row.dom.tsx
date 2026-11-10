import type { FocusEventHandler, ComponentChild as UiNode } from "preact";

export function NavRow({
  main,
  actions,
  className = "",
  persistentActions = false,
  onFocusOut,
}: {
  main: UiNode;
  actions: UiNode;
  className?: string;
  persistentActions?: boolean;
  onFocusOut?: FocusEventHandler<HTMLDivElement> | undefined;
}): UiNode {
  return (
    <div
      onFocusOut={onFocusOut}
      className={["codex-panel-ui__nav-row", className, persistentActions ? "codex-panel-ui__nav-row--actions-visible" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {main}
      <div className="codex-panel-ui__nav-row-actions">{actions}</div>
    </div>
  );
}
