export type ComposerBoundaryScrollDirection = -1 | 1;

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

export function composerBoundaryScrollDirection(
  event: ComposerBoundaryScrollKeyEvent,
  composer: ComposerBoundaryScrollTextState,
): ComposerBoundaryScrollDirection | null {
  if (event.isComposing || event.metaKey || event.altKey || event.shiftKey) return null;

  const keyDirection = composerBoundaryScrollKeyDirection(event);
  if (!keyDirection) return null;
  if (composer.selectionStart !== composer.selectionEnd) return null;

  return keyDirection === -1 ? (composerCursorOnFirstLine(composer) ? -1 : null) : composerCursorOnLastLine(composer) ? 1 : null;
}

function composerBoundaryScrollKeyDirection(event: ComposerBoundaryScrollKeyEvent): ComposerBoundaryScrollDirection | null {
  if (!event.ctrlKey) {
    if (event.key === "ArrowUp") return -1;
    if (event.key === "ArrowDown") return 1;
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "p") return -1;
  if (key === "n") return 1;
  return null;
}

function composerCursorOnFirstLine(composer: ComposerBoundaryScrollTextState): boolean {
  return !composer.value.slice(0, composer.selectionStart).includes("\n");
}

function composerCursorOnLastLine(composer: ComposerBoundaryScrollTextState): boolean {
  return !composer.value.slice(composer.selectionEnd).includes("\n");
}
