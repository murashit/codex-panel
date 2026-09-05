// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { textareaCursorAtVisualBoundary } from "../../../src/shared/dom/textarea-caret.measure";
import { installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

describe("textarea caret boundary decisions from measured positions", () => {
  afterEach(() => vi.restoreAllMocks());

  // jsdom supplies no text layout; these measurements test navigation decisions, not wrapping.
  it.each([
    { direction: -1 as const, cursorTop: 20, expected: true },
    { direction: -1 as const, cursorTop: 40, expected: false },
    { direction: 1 as const, cursorTop: 40, expected: false },
    { direction: 1 as const, cursorTop: 60, expected: true },
  ])("direction $direction at measured row $cursorTop returns $expected", ({ direction, cursorTop, expected }) => {
    const textarea = document.createElement("textarea");
    textarea.value = "previous\nwrapped current line\nnext";
    textarea.setSelectionRange(17, 17);
    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 120, 80));
    const positions = new Map([
      [9, 20],
      [17, cursorTop],
      [29, 60],
    ]);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      // The mirror must preserve textarea wrapping inputs before its measurements can be meaningful.
      expect(this.parentElement?.style.whiteSpace).toBe("pre-wrap");
      expect(this.parentElement?.style.overflowWrap).toBe("break-word");
      expect(this.parentElement?.style.width).toBe("120px");
      const position = this.previousSibling?.textContent?.length;
      const top = positions.get(position ?? -1);
      if (top === undefined) throw new Error(`Unexpected caret position: ${String(position)}`);
      return top;
    });

    expect(textareaCursorAtVisualBoundary(direction, textarea)).toBe(expected);
  });

  it("keeps arrow navigation in the textarea while text is selected", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "selected text";
    textarea.setSelectionRange(0, textarea.value.length);

    expect(textareaCursorAtVisualBoundary(-1, textarea)).toBe(false);
    expect(textareaCursorAtVisualBoundary(1, textarea)).toBe(false);
  });
});
