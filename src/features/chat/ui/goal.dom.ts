import { disposeDomListeners, listenDomEscapeKey, listenOutsideDomEvent } from "../../../shared/dom/events.dom";
import { syncTextareaHeight } from "../../../shared/dom/textarea-autogrow.measure";

export function syncGoalObjectiveHeight(textarea: HTMLTextAreaElement | null): void {
  syncTextareaHeight(textarea, {
    minHeightFallback: 56,
    maxHeightFallback: textarea ? Math.min(180, textarea.win.innerHeight * 0.3) : 180,
  });
}

export function focusGoalObjectiveEditor(textarea: HTMLTextAreaElement | null): void {
  textarea?.focus();
}

export function observeGoalObjectiveOverflow(content: HTMLElement, onOverflowChange: (overflows: boolean) => void): () => void {
  const win = content.win;
  let frame = 0;
  const update = () => {
    frame = 0;
    onOverflowChange(content.scrollHeight > goalObjectiveCollapseHeight(content) + 1);
  };
  update();
  frame = win.requestAnimationFrame(update);
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
  };
}

export function closeGoalEditorOnOutsidePointer(root: HTMLElement, onCancel: () => void): () => void {
  const closeOnEscape = (event: KeyboardEvent): void => {
    event.preventDefault();
    onCancel();
  };
  return disposeDomListeners(
    listenOutsideDomEvent(root, "pointerdown", onCancel, true),
    listenDomEscapeKey(root.ownerDocument, closeOnEscape),
  );
}

export function collapseGoalObjectiveOnOutsidePointer(root: HTMLElement, onCollapse: () => void): () => void {
  return listenOutsideDomEvent(root, "pointerdown", onCollapse, true);
}

function goalObjectiveCollapseHeight(element: HTMLElement): number {
  const lineHeight = computedLineHeight(element);
  return lineHeight * 3;
}

function computedLineHeight(element: HTMLElement): number {
  const style = element.win.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.5 : 24;
}
