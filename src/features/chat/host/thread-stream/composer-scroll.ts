import { textareaCursorAtVisualBoundary } from "../../../../shared/ui/textarea-caret.measure";
import type { ThreadStreamScrollCommand } from "../../ui/thread-stream/flow-scroll";

export type ComposerBoundaryScrollAction = Exclude<ThreadStreamScrollCommand, { kind: "show-latest" }>;

export function composerBoundaryScrollActionFromElement(
  event: KeyboardEvent,
  composer: HTMLTextAreaElement | null,
): ComposerBoundaryScrollAction | null {
  if (!composer || event.isComposing || event.metaKey || event.altKey || event.shiftKey) return null;
  const action = composerBoundaryScrollKeyAction(event);
  if (!action) return null;
  if (action.kind === "scroll-to" || action.amount === "page") return action;
  if (composer.selectionStart !== composer.selectionEnd) return null;
  const cursorAtTextBoundary =
    action.direction === -1
      ? !composer.value.slice(0, composer.selectionStart).includes("\n")
      : !composer.value.slice(composer.selectionEnd).includes("\n");
  return cursorAtTextBoundary && textareaCursorAtVisualBoundary(action.direction, composer) ? action : null;
}

function composerBoundaryScrollKeyAction(event: KeyboardEvent): ComposerBoundaryScrollAction | null {
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

function composerBoundaryScrollByAction(direction: -1 | 1, amount: "text-lines" | "page", repeat: boolean): ComposerBoundaryScrollAction {
  return repeat ? { kind: "scroll-by", direction, amount, repeated: true } : { kind: "scroll-by", direction, amount };
}
