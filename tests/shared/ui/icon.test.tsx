// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { renderUiRoot } from "../../../src/shared/dom/preact-root.dom";
import { IconButton, IconRendererProvider, ToolbarIconAction } from "../../../src/shared/ui/icon.dom";

describe("UI icons", () => {
  it("delegates host rendering while preserving button content", () => {
    const parent = document.createElement("div");
    const renderer = vi.fn();

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
    expect(renderer).toHaveBeenCalledWith(icon, "file-diff");
  });

  it("labels toolbar actions and suppresses clicks while disabled", () => {
    const parent = document.createElement("div");
    const onClick = vi.fn();

    renderUiRoot(
      parent,
      <ToolbarIconAction icon="refresh-cw" label="Refresh threads" className="clickable-icon nav-action-button" onClick={onClick} />,
    );

    let action = parent.querySelector<HTMLElement>('[aria-label="Refresh threads"]');
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
