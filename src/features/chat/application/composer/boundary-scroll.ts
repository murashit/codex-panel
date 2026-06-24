type ComposerBoundaryScrollDirection = -1 | 1;
type ComposerBoundaryScrollAmount = "text-lines" | "page";
type ComposerBoundaryScrollEdge = "start" | "end";

export type ComposerBoundaryScrollAction = ComposerBoundaryScrollByAction | ComposerBoundaryScrollToAction;

interface ComposerBoundaryScrollByAction {
  kind: "scroll-by";
  direction: ComposerBoundaryScrollDirection;
  amount: ComposerBoundaryScrollAmount;
}

interface ComposerBoundaryScrollToAction {
  kind: "scroll-to";
  edge: ComposerBoundaryScrollEdge;
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
  if (keyAction.kind === "scroll-to" || keyAction.amount === "page") return keyAction;
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
    if (event.key === "ArrowUp") return { kind: "scroll-by", direction: -1, amount: "text-lines" };
    if (event.key === "ArrowDown") return { kind: "scroll-by", direction: 1, amount: "text-lines" };
    if (event.key === "PageUp") return { kind: "scroll-by", direction: -1, amount: "page" };
    if (event.key === "PageDown") return { kind: "scroll-by", direction: 1, amount: "page" };
    if (event.key === "Home") return { kind: "scroll-to", edge: "start" };
    if (event.key === "End") return { kind: "scroll-to", edge: "end" };
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "p") return { kind: "scroll-by", direction: -1, amount: "text-lines" };
  if (key === "n") return { kind: "scroll-by", direction: 1, amount: "text-lines" };
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
