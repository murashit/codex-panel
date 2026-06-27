import { describe, expect, it, vi } from "vitest";

import {
  type ComposerBoundaryScrollAction,
  composerBoundaryScrollDirection,
} from "../../../../../src/features/chat/application/composer/boundary-scroll";

describe("composer boundary scroll shortcuts", () => {
  it("scrolls up from the first composer line", () => {
    expect(direction("ArrowUp", "first\nsecond", 3)).toEqual({ kind: "scroll-by", direction: -1, amount: "text-lines" });
    expect(direction("p", "first\nsecond", 3, { ctrlKey: true })).toEqual({
      kind: "scroll-by",
      direction: -1,
      amount: "text-lines",
    });
  });

  it("scrolls down from the last composer line", () => {
    expect(direction("ArrowDown", "first\nsecond", 9)).toEqual({ kind: "scroll-by", direction: 1, amount: "text-lines" });
    expect(direction("n", "first\nsecond", 9, { ctrlKey: true })).toEqual({
      kind: "scroll-by",
      direction: 1,
      amount: "text-lines",
    });
  });

  it("marks repeated text-line scrolling", () => {
    expect(direction("ArrowDown", "first\nsecond", 9, { repeat: true })).toEqual({
      kind: "scroll-by",
      direction: 1,
      amount: "text-lines",
      repeated: true,
    });
    expect(direction("n", "first\nsecond", 9, { ctrlKey: true, repeat: true })).toEqual({
      kind: "scroll-by",
      direction: 1,
      amount: "text-lines",
      repeated: true,
    });
  });

  it("scrolls by page from any composer line for PageUp and PageDown", () => {
    expect(direction("PageUp", "first\nsecond", 9)).toEqual({ kind: "scroll-by", direction: -1, amount: "page" });
    expect(direction("PageDown", "first\nsecond", 3)).toEqual({ kind: "scroll-by", direction: 1, amount: "page" });
    expect(direction("PageDown", "first\nsecond", 3, { cursorEnd: 8 })).toEqual({
      kind: "scroll-by",
      direction: 1,
      amount: "page",
    });
    expect(direction("PageDown", "first\nsecond", 3, { repeat: true })).toEqual({
      kind: "scroll-by",
      direction: 1,
      amount: "page",
      repeated: true,
    });
  });

  it("scrolls to stream edges from any composer line for Home and End", () => {
    expect(direction("Home", "first\nsecond", 9)).toEqual({ kind: "scroll-to", edge: "start" });
    expect(direction("End", "first\nsecond", 3)).toEqual({ kind: "scroll-to", edge: "end" });
    expect(direction("End", "first\nsecond", 3, { cursorEnd: 8 })).toEqual({ kind: "scroll-to", edge: "end" });
  });

  it("keeps normal cursor movement away from composer edges", () => {
    expect(direction("ArrowUp", "first\nsecond", 8)).toBeNull();
    expect(direction("ArrowDown", "first\nsecond", 3)).toBeNull();
  });

  it("keeps cursor movement when the visual line has not reached the composer edge", () => {
    expect(direction("ArrowUp", "wrapped first line", 8, { visualBoundary: false })).toBeNull();
    expect(direction("ArrowDown", "wrapped last line", 8, { visualBoundary: false })).toBeNull();
  });

  it("does not measure visual boundaries away from logical composer edges", () => {
    const visualBoundary = vi.fn(() => true);
    expect(direction("ArrowUp", "first\nsecond", 8, { visualBoundary })).toBeNull();
    expect(direction("ArrowDown", "first\nsecond", 3, { visualBoundary })).toBeNull();
    expect(visualBoundary).not.toHaveBeenCalled();
  });

  it("ignores selections, composition, and modified arrow keys", () => {
    expect(direction("ArrowUp", "first\nsecond", 3, { cursorEnd: 4 })).toBeNull();
    expect(direction("ArrowUp", "first\nsecond", 3, { isComposing: true })).toBeNull();
    expect(direction("ArrowUp", "first\nsecond", 3, { shiftKey: true })).toBeNull();
    expect(direction("ArrowUp", "first\nsecond", 3, { altKey: true })).toBeNull();
  });
});

function direction(
  key: string,
  value: string,
  cursorStart: number,
  options: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    isComposing: boolean;
    repeat: boolean;
    cursorEnd: number;
    visualBoundary: boolean | ((direction: -1 | 1) => boolean);
  }> = {},
): ComposerBoundaryScrollAction | null {
  const visualOptions =
    options.visualBoundary === undefined
      ? {}
      : {
          cursorAtVisualBoundary:
            typeof options.visualBoundary === "function" ? options.visualBoundary : () => options.visualBoundary as boolean,
        };
  return composerBoundaryScrollDirection(
    {
      key,
      repeat: options.repeat ?? false,
      ctrlKey: options.ctrlKey ?? false,
      metaKey: options.metaKey ?? false,
      altKey: options.altKey ?? false,
      shiftKey: options.shiftKey ?? false,
      isComposing: options.isComposing ?? false,
    },
    {
      value,
      cursorStart,
      cursorEnd: options.cursorEnd ?? cursorStart,
    },
    visualOptions,
  );
}
