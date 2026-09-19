import { syncComposerHeight } from "../../ui/composer/height";

interface ComposerElementRangeInsertion {
  value: string;
  start: number;
  end: number;
}

export interface ComposerElementSelection extends ComposerElementRangeInsertion {
  direction: "forward" | "backward" | "none";
}

export function composerRangeInsertionSource(composer: HTMLTextAreaElement | null): ComposerElementRangeInsertion | null {
  if (!composer) return null;
  return {
    value: composer.value,
    start: composer.selectionStart,
    end: composer.selectionEnd,
  };
}

export function composerSelectionSource(composer: HTMLTextAreaElement | null): ComposerElementSelection | null {
  if (!composer) return null;
  return {
    value: composer.value,
    start: composer.selectionStart,
    end: composer.selectionEnd,
    direction: composer.selectionDirection,
  };
}

export function applyComposerInsertionToElement(composer: HTMLTextAreaElement | null, cursor: number): void {
  if (!composer) return;
  syncComposerHeight(composer);
  composer.focus();
  composer.setSelectionRange(cursor, cursor);
}
