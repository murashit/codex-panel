import { setIcon } from "obsidian";

const COMPOSER_META_EFFORT_HIDDEN_CLASS = "is-effort-hidden";
const COMPOSER_META_MODEL_HIDDEN_CLASS = "is-model-hidden";

export function renderComposerMetaIcon(element: HTMLElement, icon: string): void {
  element.replaceChildren();
  setIcon(element, icon);
}

export function updateComposerMetaStatusOverflow(status: HTMLElement): void {
  status.classList.remove(COMPOSER_META_EFFORT_HIDDEN_CLASS, COMPOSER_META_MODEL_HIDDEN_CLASS);
  if (!composerMetaStatusOverflowing(status)) return;
  if (status.querySelector(".codex-panel__composer-meta-field--effort")) {
    status.classList.add(COMPOSER_META_EFFORT_HIDDEN_CLASS);
  }
  if (!composerMetaStatusOverflowing(status)) return;
  if (status.querySelector(".codex-panel__composer-meta-field--model")) {
    status.classList.add(COMPOSER_META_MODEL_HIDDEN_CLASS);
  }
}

export function scrollComposerSuggestionIntoView(container: HTMLElement, option: HTMLElement): void {
  const optionTop = option.offsetTop;
  const optionBottom = optionTop + option.offsetHeight;
  const viewportTop = container.scrollTop;
  const viewportBottom = viewportTop + container.clientHeight;

  if (optionTop < viewportTop) {
    container.scrollTop = Math.max(0, optionTop);
  } else if (optionBottom > viewportBottom) {
    container.scrollTop = Math.max(0, optionBottom - container.clientHeight);
  }
}

function composerMetaStatusOverflowing(status: HTMLElement): boolean {
  return status.scrollWidth > status.clientWidth;
}
