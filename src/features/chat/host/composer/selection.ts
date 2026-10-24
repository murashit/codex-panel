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
