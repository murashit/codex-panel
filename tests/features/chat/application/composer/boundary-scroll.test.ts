import { describe, expect, it } from "vitest";

import {
  type ComposerBoundaryScrollAction,
  composerBoundaryScrollDirection,
} from "../../../../../src/features/chat/application/composer/boundary-scroll";

describe("composer boundary scroll shortcuts", () => {
  it.each([
    { key: "ArrowUp", cursor: 3, options: {}, expectedDirection: -1 },
    { key: "p", cursor: 3, options: { ctrlKey: true }, expectedDirection: -1 },
    { key: "ArrowDown", cursor: 9, options: {}, expectedDirection: 1 },
    { key: "n", cursor: 9, options: { ctrlKey: true }, expectedDirection: 1 },
  ] as const)("scrolls from a composer edge for $key", ({ key, cursor, options, expectedDirection }) => {
    expect(direction(key, "first\nsecond", cursor, options)).toEqual({
      kind: "scroll-by",
      direction: expectedDirection,
      amount: "text-lines",
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
