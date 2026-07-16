// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it, vi } from "vitest";
import { renderUiRoot } from "../../../src/shared/dom/preact-root.dom";
import { ObsidianToolbarAction } from "../../../src/shared/obsidian/components.obsidian";
import { installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

describe("Obsidian UI components", () => {
  it("renders toolbar actions with Obsidian native structure and interaction semantics", () => {
    const parent = document.createElement("div");
    const onClick = vi.fn();

    renderUiRoot(
      parent,
      h(ObsidianToolbarAction, {
        icon: "refresh-cw",
        label: "Refresh threads",
        className: "clickable-icon nav-action-button",
        onClick,
      }),
    );

    const action = parent.querySelector<HTMLElement>('[aria-label="Refresh threads"]');
    if (!action) throw new Error("Expected toolbar action");
    expect(action.tagName).toBe("DIV");
    expect(action.getAttribute("role")).toBeNull();
    expect(action.classList.contains("clickable-icon")).toBe(true);
    expect(action.classList.contains("nav-action-button")).toBe(true);
    action.click();
    expect(onClick).toHaveBeenCalledOnce();

    renderUiRoot(
      parent,
      h(ObsidianToolbarAction, {
        icon: "refresh-cw",
        label: "Refresh threads",
        className: "clickable-icon nav-action-button",
        disabled: true,
        onClick,
      }),
    );

    const disabledAction = parent.querySelector<HTMLElement>('[aria-label="Refresh threads"]');
    if (!disabledAction) throw new Error("Expected disabled toolbar action");
    expect(disabledAction.classList.contains("is-disabled")).toBe(true);
    disabledAction.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
