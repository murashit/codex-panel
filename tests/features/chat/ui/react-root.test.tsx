// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { renderReactRoot, unmountReactRoot } from "../../../../src/shared/ui/react-root";

describe("Preact compat root adapter", () => {
  it("reuses roots that render no host children", () => {
    const parent = document.createElement("div");

    renderReactRoot(parent, null);
    renderReactRoot(parent, <button type="button">Ready</button>);

    expect(parent.querySelector("button")?.textContent).toBe("Ready");
    unmountReactRoot(parent);
  });

  it("recovers when a non-empty host is emptied imperatively", () => {
    const parent = document.createElement("div");

    renderReactRoot(parent, <button type="button">Before</button>);
    parent.replaceChildren();
    renderReactRoot(parent, <button type="button">After</button>);

    expect(parent.querySelector("button")?.textContent).toBe("After");
    unmountReactRoot(parent);
  });
});
