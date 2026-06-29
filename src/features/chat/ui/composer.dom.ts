import { setIcon } from "obsidian";

import { disposeDomListeners, listenDomEscapeKey, listenDomEvent, listenOutsideDomEvent } from "../../../shared/ui/dom-events.dom";
import { syncTextareaHeight } from "../../../shared/ui/textarea-autogrow.measure";

const COMPOSER_META_EFFORT_HIDDEN_CLASS = "is-effort-hidden";
const COMPOSER_META_MODEL_HIDDEN_CLASS = "is-model-hidden";

export interface ComposerTextSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

export interface ComposerMetaPickerState {
  kind: "model" | "effort";
  left: number;
}

export function renderComposerMetaIcon(element: HTMLElement, icon: string): void {
  element.replaceChildren();
  setIcon(element, icon);
}

export function syncComposerHeight(composer: HTMLTextAreaElement | null): boolean {
  const previousHeight = composer?.style.height ?? "";
  const previousOverflowY = composer?.style.overflowY ?? "";
  syncTextareaHeight(composer, {
    minHeightFallback: 56,
    maxHeightFallback: composer ? Math.min(208, composer.win.innerHeight * 0.4) : 208,
  });
  return Boolean(composer && (composer.style.height !== previousHeight || composer.style.overflowY !== previousOverflowY));
}

export function preserveComposerSelection(
  composer: HTMLTextAreaElement | null,
  previousDraft: string,
  nextDraft: string,
): ComposerTextSelection | null {
  if (!composer || previousDraft !== nextDraft) return null;
  return {
    start: composer.selectionStart,
    end: composer.selectionEnd,
    direction: composer.selectionDirection,
  };
}

export function restoreComposerSelection(composer: HTMLTextAreaElement | null, selection: ComposerTextSelection | null): void {
  if (!composer || !selection) return;
  composer.setSelectionRange(selection.start, selection.end, selection.direction);
}

export function restoreComposerCursor(composer: HTMLTextAreaElement | null, cursor: number): void {
  if (!composer) return;
  composer.setSelectionRange(cursor, cursor);
}

export function observeComposerMetaStatusOverflow(status: HTMLElement): () => void {
  const win = status.win;
  let frame = 0;
  const update = () => {
    frame = 0;
    updateComposerMetaStatusOverflow(status);
  };
  const scheduleUpdate = () => {
    if (frame) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(update);
  };
  update();
  const ResizeObserverCtor = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const observer = ResizeObserverCtor ? new ResizeObserverCtor(scheduleUpdate) : null;
  observer?.observe(status);
  const disposeResize = listenDomEvent(win, "resize", scheduleUpdate);
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    observer?.disconnect();
    disposeResize();
  };
}

export function closeComposerMetaPickerOnOutsidePointer(metaRoot: HTMLElement, onClose: () => void): () => void {
  return disposeDomListeners(listenOutsideDomEvent(metaRoot, "mousedown", onClose), listenDomEscapeKey(metaRoot.ownerDocument, onClose));
}

export function composerMetaPickerState(
  kind: ComposerMetaPickerState["kind"],
  trigger: HTMLElement | null,
  metaRoot: HTMLElement | null,
): ComposerMetaPickerState {
  if (!trigger || !metaRoot) return { kind, left: 0 };
  const triggerRect = trigger.getBoundingClientRect();
  const metaRect = metaRoot.getBoundingClientRect();
  return {
    kind,
    left: Math.max(0, triggerRect.left - metaRect.left),
  };
}

function updateComposerMetaStatusOverflow(status: HTMLElement): void {
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
