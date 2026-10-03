// @vitest-environment jsdom

import { useLayoutEffect } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";

import { renderUiRoot, unmountUiRoot } from "../../../src/shared/ui/preact-root.dom";

describe("Preact root adapter", () => {
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
