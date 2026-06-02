// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { renderUiRoot, unmountUiRoot } from "../../../../src/shared/ui/ui-root";

describe("Preact root adapter", () => {
  it("reuses roots that render no host children", () => {
    const parent = document.createElement("div");

    renderUiRoot(parent, null);
    renderUiRoot(parent, <button type="button">Ready</button>);

    expect(parent.querySelector("button")?.textContent).toBe("Ready");
    unmountUiRoot(parent);
  });

  it("recovers when a non-empty host is emptied imperatively", () => {
    const parent = document.createElement("div");

    renderUiRoot(parent, <button type="button">Before</button>);
    parent.replaceChildren();
    renderUiRoot(parent, <button type="button">After</button>);

    expect(parent.querySelector("button")?.textContent).toBe("After");
    unmountUiRoot(parent);
  });
});
