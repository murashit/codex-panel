type ComposerBoundaryScrollDirection = -1 | 1;
type ComposerBoundaryScrollAmount = "text-lines" | "page";
type ComposerBoundaryScrollEdge = "start" | "end";

export type ComposerBoundaryScrollAction = ComposerBoundaryScrollByAction | ComposerBoundaryScrollToAction;

interface ComposerBoundaryScrollByAction {
  kind: "scroll-by";
  direction: ComposerBoundaryScrollDirection;
  amount: ComposerBoundaryScrollAmount;
  repeated?: boolean;
}

interface ComposerBoundaryScrollToAction {
  kind: "scroll-to";
  edge: ComposerBoundaryScrollEdge;
}

export interface ComposerBoundaryScrollKeyEvent {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

export interface ComposerBoundaryScrollTextState {
  value: string;
  cursorStart: number;
  cursorEnd: number;
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
  if (composer.cursorStart !== composer.cursorEnd) return null;

  const cursorAtTextBoundary =
    keyAction.direction === -1
      ? !composer.value.slice(0, composer.cursorStart).includes("\n")
      : !composer.value.slice(composer.cursorEnd).includes("\n");
  return cursorAtTextBoundary && composerCursorAtVisualBoundary(keyAction.direction, composer, options) ? keyAction : null;
}

function composerBoundaryScrollKeyAction(event: ComposerBoundaryScrollKeyEvent): ComposerBoundaryScrollAction | null {
  if (!event.ctrlKey) {
    if (event.key === "ArrowUp") return composerBoundaryScrollByAction(-1, "text-lines", event.repeat);
    if (event.key === "ArrowDown") return composerBoundaryScrollByAction(1, "text-lines", event.repeat);
    if (event.key === "PageUp") return composerBoundaryScrollByAction(-1, "page", event.repeat);
    if (event.key === "PageDown") return composerBoundaryScrollByAction(1, "page", event.repeat);
    if (event.key === "Home") return { kind: "scroll-to", edge: "start" };
    if (event.key === "End") return { kind: "scroll-to", edge: "end" };
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "p") return composerBoundaryScrollByAction(-1, "text-lines", event.repeat);
  if (key === "n") return composerBoundaryScrollByAction(1, "text-lines", event.repeat);
  return null;
}

function composerBoundaryScrollByAction(
  direction: ComposerBoundaryScrollDirection,
  amount: ComposerBoundaryScrollAmount,
  repeat: boolean,
): ComposerBoundaryScrollByAction {
  return repeat ? { kind: "scroll-by", direction, amount, repeated: true } : { kind: "scroll-by", direction, amount };
}

function composerCursorAtVisualBoundary(
  direction: ComposerBoundaryScrollDirection,
  composer: ComposerBoundaryScrollTextState,
  options: ComposerBoundaryScrollOptions,
): boolean {
  return options.cursorAtVisualBoundary?.(direction, composer) ?? true;
}
