import { listenOutsideDomEvent } from "../../../../shared/dom/events.dom";

export function closeStreamItemRoleMenuOnOutsidePointer(root: HTMLElement, onClose: () => void): () => void {
  return listenOutsideDomEvent(root, "pointerdown", onClose, true);
}
