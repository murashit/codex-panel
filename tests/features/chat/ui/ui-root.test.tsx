// @vitest-environment jsdom

import { useLayoutEffect } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";

import { renderUiRoot, unmountUiRoot } from "../../../../src/shared/ui/ui-root.dom";

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

  it("runs Preact cleanup before an external replaceChildren empties the host", () => {
    const parent = document.createElement("div");
    const cleanup = vi.fn();

    renderUiRoot(parent, <CleanupProbe cleanup={cleanup} />);
    expect(cleanup).not.toHaveBeenCalled();

    parent.replaceChildren();

    expect(cleanup).toHaveBeenCalledOnce();
    renderUiRoot(parent, <button type="button">After</button>);
    expect(parent.querySelector("button")?.textContent).toBe("After");
    unmountUiRoot(parent);
  });
});

function CleanupProbe({ cleanup }: { cleanup: () => void }) {
  useLayoutEffect(() => cleanup, [cleanup]);
  return <button type="button">Before</button>;
}
