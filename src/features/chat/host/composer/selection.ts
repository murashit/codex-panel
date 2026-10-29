import type { ComposerSelection } from "../../application/composer/selection";

export function composerSelectionSource(composer: HTMLTextAreaElement | null): ComposerSelection | null {
  if (!composer) return null;
  return {
    value: composer.value,
    start: composer.selectionStart,
    end: composer.selectionEnd,
    direction: composer.selectionDirection,
  };
}
