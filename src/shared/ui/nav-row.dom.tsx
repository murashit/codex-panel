import type { ComponentChild as UiNode } from "preact";

export function NavRow({
  main,
  actions,
  className = "",
  persistentActions = false,
}: {
  main: UiNode;
  actions: UiNode;
  className?: string;
  persistentActions?: boolean;
}): UiNode {
  return (
    <div
      className={["codex-panel-ui__nav-row", className, persistentActions ? "codex-panel-ui__nav-row--actions-visible" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {main}
      <div className="codex-panel-ui__nav-row-actions">{actions}</div>
    </div>
  );
}
