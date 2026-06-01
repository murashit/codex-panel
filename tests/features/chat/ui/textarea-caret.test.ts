// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { composerCursorAtVisualTextareaBoundary } from "../../../../src/features/chat/ui/textarea-caret";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();

describe("textarea caret visual boundary measurement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies mirror wrapping styles through CSS property names", () => {
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
    const offsetTop = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function offsetTopGetter(this: HTMLElement) {
      const parent = this.parentElement;
      if (parent instanceof HTMLElement) mirrorStyles.push(parent.style);
      return 0;
    });

    expect(composerCursorAtVisualTextareaBoundary(-1, textarea)).toBe(true);
    expect(offsetTop).toHaveBeenCalled();
    expect(mirrorStyles.length).toBeGreaterThan(0);
    for (const style of mirrorStyles) {
      expect(style.getPropertyValue("white-space")).toBe("pre-wrap");
      expect(style.getPropertyValue("overflow-wrap")).toBe("break-word");
      expect(style.getPropertyValue("word-break")).toBe("normal");
      expect(style.getPropertyValue("min-height")).toBe("0px");
      expect(style.getPropertyValue("max-height")).toBe("none");
    }
  });
});
