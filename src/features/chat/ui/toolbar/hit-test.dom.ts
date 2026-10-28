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

  const archiveConfirm = target.closest(".codex-panel__archive-confirm");
  const insideArchiveConfirm = Boolean(archiveConfirm && root.contains(archiveConfirm));
  const toolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
  if (!toolbarPanel || !root.contains(toolbarPanel)) {
    return { insideToolbarPanel: false, insideArchiveConfirm };
  }

  return {
    insideToolbarPanel: true,
    insideArchiveConfirm,
  };
}
