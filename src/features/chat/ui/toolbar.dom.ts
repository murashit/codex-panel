export function focusToolbarRenameInput(input: HTMLInputElement | null): void {
  if (!input) return;
  if (input.ownerDocument.activeElement === input) return;
  input.focus();
  input.select();
}

export interface ToolbarOutsidePointerHit {
  insideToolbarPanel: boolean;
  insideArchiveConfirm: boolean;
}

export function toolbarOutsidePointerHit(
  event: PointerEvent,
  root: HTMLElement | null,
  viewWindow: Window | null,
): ToolbarOutsidePointerHit {
  const target = event.target;
  const domWindow = viewWindow as (Window & { Element: typeof Element }) | null;
  if (!root || !domWindow || !(target instanceof domWindow.Element)) {
    return { insideToolbarPanel: false, insideArchiveConfirm: false };
  }

  const toolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
  if (!toolbarPanel || !root.contains(toolbarPanel)) {
    return { insideToolbarPanel: false, insideArchiveConfirm: false };
  }

  return {
    insideToolbarPanel: true,
    insideArchiveConfirm: Boolean(target.closest(".codex-panel__archive-confirm")),
  };
}
