import { textareaCursorAtVisualBoundary } from "../../../shared/dom/textarea-caret.measure";
import { type ComposerBoundaryScrollAction, composerBoundaryScrollDirection } from "../application/composer/boundary-scroll";
import { composerSuggestionSignature } from "../application/composer/suggestions";
import { syncComposerHeight } from "../ui/composer.dom";

export interface ComposerElementInsertion {
  value: string;
  cursor: number;
}

export interface ComposerElementRangeInsertion {
  value: string;
  start: number;
  end: number;
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

export function composerRangeInsertionSource(composer: HTMLTextAreaElement | null): ComposerElementRangeInsertion | null {
  if (!composer) return null;
  return {
    value: composer.value,
    start: composer.selectionStart,
    end: composer.selectionEnd,
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

export function composerFilesFromTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const transfer = dataTransfer as Partial<DataTransfer>;
  const files = Array.from(transfer.files ?? []).filter((file) => file.size > 0);
  if (files.length > 0) return files;

  return Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .flatMap((item) => {
      const file = item.getAsFile();
      return file && file.size > 0 ? [file] : [];
    });
}

export function composerTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const transfer = dataTransfer as Partial<DataTransfer>;
  if (Array.from(transfer.types ?? []).includes("Files")) return true;
  if (Array.from(transfer.items ?? []).some((item) => item.kind === "file")) return true;
  return Array.from(transfer.files ?? []).some((file) => file.size > 0);
}
