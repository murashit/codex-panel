// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { renderUiRoot } from "../../../src/shared/dom/preact-root.dom";
import { IconButton, IconRendererProvider, ToolbarIconAction } from "../../../src/shared/ui/icon.dom";

describe("UI icons", () => {
  it("keeps icon identity without requiring a host renderer", () => {
    const parent = document.createElement("div");

    renderUiRoot(parent, <IconButton icon="send" label="Send" />);

    const button = parent.querySelector<HTMLButtonElement>("button");
    expect(button?.dataset["icon"]).toBe("send");
    expect(button?.getAttribute("aria-label")).toBe("Send");
  });

  it("delegates host rendering while preserving button content", () => {
    const parent = document.createElement("div");
    const renderer = vi.fn((element: HTMLElement, icon: string) => {
      element.dataset["renderedIcon"] = icon;
    });

    renderUiRoot(
      parent,
      <IconRendererProvider renderer={renderer}>
        <IconButton icon="file-diff" label="View diff">
          View diff
        </IconButton>
      </IconRendererProvider>,
    );

    const button = parent.querySelector<HTMLButtonElement>("button");
    const icon = button?.querySelector<HTMLElement>("span");
    expect(button?.textContent).toBe("View diff");
    expect(icon?.dataset["icon"]).toBe("file-diff");
    expect(icon?.dataset["renderedIcon"]).toBe("file-diff");
    expect(renderer).toHaveBeenCalledWith(icon, "file-diff");
  });

  it("keeps toolbar action structure and interaction semantics", () => {
    const parent = document.createElement("div");
    const onClick = vi.fn();

    renderUiRoot(
      parent,
      <ToolbarIconAction icon="refresh-cw" label="Refresh threads" className="clickable-icon nav-action-button" onClick={onClick} />,
    );

    let action = parent.querySelector<HTMLElement>('[aria-label="Refresh threads"]');
    expect(action?.tagName).toBe("DIV");
    expect(action?.getAttribute("role")).toBeNull();
    expect(action?.classList.contains("clickable-icon")).toBe(true);
    expect(action?.classList.contains("nav-action-button")).toBe(true);
    action?.click();
    expect(onClick).toHaveBeenCalledOnce();

    renderUiRoot(
      parent,
      <ToolbarIconAction
        icon="refresh-cw"
        label="Refresh threads"
        className="clickable-icon nav-action-button"
        disabled
        onClick={onClick}
      />,
    );

    action = parent.querySelector<HTMLElement>('[aria-label="Refresh threads"]');
    expect(action?.classList.contains("is-disabled")).toBe(true);
    action?.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
