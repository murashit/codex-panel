import type { Component } from "obsidian";
import { listenDomEvent } from "./events.dom";

export function registerViewPointerDown(owner: Component, root: HTMLElement, handler: (event: PointerEvent) => void): void {
  let removeListener = listenDomEvent(root.ownerDocument, "pointerdown", handler);
  owner.register(
    root.onWindowMigrated((win) => {
      removeListener();
      removeListener = listenDomEvent(win.document, "pointerdown", handler);
    }),
  );
  owner.register(() => {
    removeListener();
  });
}
