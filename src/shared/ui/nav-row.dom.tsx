import type { FocusEventHandler, KeyboardEventHandler, ComponentChild as UiNode } from "preact";

export function NavRow({
  main,
  actions,
  className = "",
  persistentActions = false,
  onFocusOut,
  onKeyDown,
}: {
  main: UiNode;
  actions: UiNode;
  className?: string;
  persistentActions?: boolean;
  onFocusOut?: FocusEventHandler<HTMLDivElement> | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement> | undefined;
}): UiNode {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The row delegates bubbled keyboard events from its native controls without becoming a separate keyboard target.
    <div
      onFocusOut={onFocusOut}
      onKeyDown={onKeyDown}
      className={["codex-panel-ui__nav-row", className, persistentActions ? "codex-panel-ui__nav-row--actions-visible" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {main}
      <div className="codex-panel-ui__nav-row-actions">{actions}</div>
    </div>
  );
}
