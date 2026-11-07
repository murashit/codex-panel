// @vitest-environment jsdom

import { describe, expect, it, onTestFinished } from "vitest";
import { IconButton } from "../../../src/shared/ui/icon.dom";
import { NavRow } from "../../../src/shared/ui/nav-row.dom";
import { renderUiRoot, unmountUiRoot } from "../../../src/shared/ui/preact-root.dom";
import { mountAuthoredStyles } from "../../support/authored-styles";

function mountRow() {
  const style = mountAuthoredStyles();
  const parent = document.createElement("div");
  document.body.append(parent);
  onTestFinished(() => {
    unmountUiRoot(parent);
    parent.remove();
  });
  const render = (persistentActions = false) => {
    renderUiRoot(
      parent,
      <NavRow
        persistentActions={persistentActions}
        main={<input aria-label="Thread name" />}
        actions={<IconButton className="codex-panel-ui__nav-row-action" icon="pencil" label="Rename" />}
      />,
    );
  };
  render();
  const row = parent.querySelector<HTMLElement>(".codex-panel-ui__nav-row");
  const slot = parent.querySelector<HTMLElement>(".codex-panel-ui__nav-row-actions");
  const input = parent.querySelector("input");
  const button = parent.querySelector("button");
  if (!row || !slot || !input || !button) throw new Error("Missing navigation row controls");
  return { style, row, slot, input, button, render };
}

function expectExposed(row: HTMLElement, slot: HTMLElement): void {
  expect(getComputedStyle(row).gridTemplateColumns).toBe("minmax(0, 1fr) auto");
  const slotStyle = getComputedStyle(slot);
  expect(slotStyle.overflow).toBe("visible");
  expect(slotStyle.opacity).not.toBe("0");
  expect(slotStyle.pointerEvents).not.toBe("none");
}

describe("navigation row action availability", () => {
  it("collapses one clipped slot at rest and releases it on native keyboard focus", () => {
    const { row, slot, input, button } = mountRow();

    expect(getComputedStyle(row).gridTemplateColumns).toBe("minmax(0, 1fr) 0");
    expect(getComputedStyle(slot).overflow).toBe("hidden");

    input.focus();
    expectExposed(row, slot);
    button.focus();
    expectExposed(row, slot);
    button.blur();
    expect(getComputedStyle(slot).overflow).toBe("hidden");
  });

  it("keeps persistent actions exposed without focus", () => {
    const { row, slot, button, render } = mountRow();

    render(true);
    expect(row.contains(document.activeElement)).toBe(false);
    expectExposed(row, slot);
    expect(getComputedStyle(button).opacity).not.toBe("0");

    render(false);
    expect(getComputedStyle(slot).overflow).toBe("hidden");
  });

  it("authors the same track and clip release for hover", () => {
    const { style } = mountRow();
    // jsdom does not reliably recompute :hover. Guard these two authored declarations only;
    // native focus and persistent-state tests above exercise the actual cascade, not geometry.
    for (const [selector, property, expected] of [
      [".codex-panel-ui__nav-row:hover", "grid-template-columns", "minmax(0, 1fr) auto"],
      [".codex-panel-ui__nav-row:hover > .codex-panel-ui__nav-row-actions", "overflow", "visible"],
    ] as const) {
      const rule = [...(style.sheet?.cssRules ?? [])].find(
        (candidate): candidate is CSSStyleRule =>
          candidate instanceof CSSStyleRule &&
          candidate.selectorText.split(",").some((part) => part.trim() === selector) &&
          candidate.style.getPropertyValue(property) !== "",
      );
      expect(rule?.style.getPropertyValue(property)).toBe(expected);
    }
  });
});
