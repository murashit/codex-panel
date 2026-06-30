import { listenOutsideDomEvent } from "../../../../shared/ui/dom-events.dom";

export function closeMessageRoleMenuOnOutsidePointer(root: HTMLElement, onClose: () => void): () => void {
  return listenOutsideDomEvent(root, "pointerdown", onClose, true);
}
