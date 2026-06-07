type ComposerBoundaryScrollDirection = -1 | 1;
type ComposerBoundaryScrollAmount = "text-lines" | "page";

export interface ComposerBoundaryScrollAction {
  direction: ComposerBoundaryScrollDirection;
  amount: ComposerBoundaryScrollAmount;
}

export interface ComposerBoundaryScrollKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

export interface ComposerBoundaryScrollTextState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface ComposerBoundaryScrollOptions {
  cursorAtVisualBoundary?: (direction: ComposerBoundaryScrollDirection, composer: ComposerBoundaryScrollTextState) => boolean;
}

export function composerBoundaryScrollDirection(
  event: ComposerBoundaryScrollKeyEvent,
  composer: ComposerBoundaryScrollTextState,
  options: ComposerBoundaryScrollOptions = {},
): ComposerBoundaryScrollAction | null {
  if (event.isComposing || event.metaKey || event.altKey || event.shiftKey) return null;

  const keyAction = composerBoundaryScrollKeyAction(event);
  if (!keyAction) return null;
  if (keyAction.amount === "page") return keyAction;
  if (composer.selectionStart !== composer.selectionEnd) return null;

  return keyAction.direction === -1
    ? composerCursorOnFirstLine(composer) && composerCursorAtVisualBoundary(keyAction.direction, composer, options)
      ? keyAction
      : null
    : composerCursorOnLastLine(composer) && composerCursorAtVisualBoundary(keyAction.direction, composer, options)
      ? keyAction
      : null;
}

function composerBoundaryScrollKeyAction(event: ComposerBoundaryScrollKeyEvent): ComposerBoundaryScrollAction | null {
  if (!event.ctrlKey) {
    if (event.key === "ArrowUp") return { direction: -1, amount: "text-lines" };
    if (event.key === "ArrowDown") return { direction: 1, amount: "text-lines" };
    if (event.key === "PageUp") return { direction: -1, amount: "page" };
    if (event.key === "PageDown") return { direction: 1, amount: "page" };
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "p") return { direction: -1, amount: "text-lines" };
  if (key === "n") return { direction: 1, amount: "text-lines" };
  return null;
}

function composerCursorOnFirstLine(composer: ComposerBoundaryScrollTextState): boolean {
  return !composer.value.slice(0, composer.selectionStart).includes("\n");
}

function composerCursorOnLastLine(composer: ComposerBoundaryScrollTextState): boolean {
  return !composer.value.slice(composer.selectionEnd).includes("\n");
}

function composerCursorAtVisualBoundary(
  direction: ComposerBoundaryScrollDirection,
  composer: ComposerBoundaryScrollTextState,
  options: ComposerBoundaryScrollOptions,
): boolean {
  return options.cursorAtVisualBoundary?.(direction, composer) ?? true;
}
