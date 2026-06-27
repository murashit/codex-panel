import { textareaCursorAtVisualBoundary } from "../../../shared/ui/textarea-caret.measure";
import { type ComposerBoundaryScrollAction, composerBoundaryScrollDirection } from "../application/composer/boundary-scroll";
import { composerSuggestionSignature } from "../application/composer/suggestions";
import { syncComposerHeight } from "../ui/composer.dom";

export interface ComposerElementInsertion {
  value: string;
  cursor: number;
}

export function focusComposer(composer: HTMLTextAreaElement | null, options: { preventScroll?: boolean } = {}): void {
  composer?.focus(options);
}

export function composerHasFocus(composer: HTMLTextAreaElement | null): boolean {
  return composer !== null && composer.ownerDocument.activeElement === composer;
}

export function composerTextBeforeCursor(composer: HTMLTextAreaElement | null): string | null {
  if (!composer) return null;
  return composer.value.slice(0, composer.selectionStart);
}

export function composerSuggestionSignatureFromElement(composer: HTMLTextAreaElement | null): string | null {
  if (!composer) return null;
  return composerSuggestionSignature(composer.value, composer.selectionStart);
}

export function composerInsertionSource(composer: HTMLTextAreaElement | null): ComposerElementInsertion | null {
  if (!composer) return null;
  return {
    value: composer.value,
    cursor: composer.selectionStart,
  };
}

export function composerBoundaryScrollActionFromElement(
  event: KeyboardEvent,
  composer: HTMLTextAreaElement | null,
): ComposerBoundaryScrollAction | null {
  if (!composer) return null;
  const textState = {
    value: composer.value,
    cursorStart: composer.selectionStart,
    cursorEnd: composer.selectionEnd,
  };
  return composerBoundaryScrollDirection(event, textState, {
    cursorAtVisualBoundary: (direction) => textareaCursorAtVisualBoundary(direction, composer),
  });
}

export function applyComposerInsertionToElement(composer: HTMLTextAreaElement | null, cursor: number): void {
  if (!composer) return;
  syncComposerHeight(composer);
  composer.focus();
  composer.setSelectionRange(cursor, cursor);
}
