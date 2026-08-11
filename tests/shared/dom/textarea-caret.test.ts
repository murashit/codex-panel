// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { textareaCursorAtVisualBoundary } from "../../../src/shared/dom/textarea-caret.measure";
import { installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

describe("textarea caret visual boundary measurement", () => {
  afterEach(() => vi.restoreAllMocks());

  it("measures wrapped lines with textarea-compatible mirror styles", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "a long composer line that wraps";
    textarea.setSelectionRange(8, 8);
    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
      width: 120,
      height: 40,
      top: 0,
      right: 120,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const mirrorStyles: CSSStyleDeclaration[] = [];
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function offsetTopGetter(this: HTMLElement) {
      if (this.parentElement instanceof HTMLElement) mirrorStyles.push(this.parentElement.style);
      return 0;
    });

    textareaCursorAtVisualBoundary(-1, textarea);

    expect(mirrorStyles).not.toHaveLength(0);
    expect(mirrorStyles[0]?.getPropertyValue("white-space")).toBe("pre-wrap");
    expect(mirrorStyles[0]?.getPropertyValue("overflow-wrap")).toBe("break-word");
  });
});
