import { setIcon } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import { renderUiRoot } from "../dom/preact-root.dom";
import { IconRendererProvider } from "../ui/icon.dom";

export function renderObsidianUiRoot(container: HTMLElement, node: UiNode): void {
  renderUiRoot(container, <IconRendererProvider renderer={setIcon}>{node}</IconRendererProvider>);
}
