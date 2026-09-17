import { setIcon } from "obsidian";
import type { ComponentChild as UiNode } from "preact";
import { IconRendererProvider } from "./icon.dom";
import { renderUiRoot } from "./preact-root.dom";

export function renderObsidianUiRoot(container: HTMLElement, node: UiNode): void {
  renderUiRoot(container, <IconRendererProvider renderer={setIcon}>{node}</IconRendererProvider>);
}
