import { describe, expect, it } from "vitest";

import { splitUtf8Context, truncateUtf8, utf8ByteLength } from "../../../src/domain/chat/context-budget";

describe("UTF-8 context budgets", () => {
  it.each([
    { value: "", maxBytes: 10, expected: "" },
    { value: "text", maxBytes: 0, expected: "" },
    { value: "text", maxBytes: -1, expected: "" },
    { value: "ascii", maxBytes: 5, expected: "ascii" },
    { value: "あい", maxBytes: 3, expected: "あ" },
    { value: "A😀B", maxBytes: 5, expected: "A😀" },
    { value: "A😀B", maxBytes: 4, expected: "A" },
  ])("truncates $value to at most $maxBytes bytes", ({ value, maxBytes, expected }) => {
    const result = truncateUtf8(value, maxBytes);

    expect(result).toBe(expected);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(Math.max(maxBytes, 0));
    expect(result).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/);
  });

  it.each([
    {
      label: "paragraph",
      value: "abc\n\ndef",
      maxBytes: 6,
      expected: ["abc\n\n", "def"],
    },
    {
      label: "newline",
      value: "alpha\nbeta",
      maxBytes: 7,
      expected: ["alpha\n", "beta"],
    },
    {
      label: "space",
      value: "alpha beta gamma",
      maxBytes: 10,
      expected: ["alpha ", "beta gamma"],
    },
  ])("prefers a $label boundary when splitting", ({ value, maxBytes, expected }) => {
    const result = splitUtf8Context(value, maxBytes, 10);

    expect(result.parts).toEqual(expected);
    expect(result.parts.join("")).toBe(value);
    expect(result.includedBytes).toBe(utf8ByteLength(value));
    expect(result.parts.every((part) => utf8ByteLength(part) <= maxBytes)).toBe(true);
  });

  it("honors maxParts and reports only included bytes", () => {
    expect(splitUtf8Context("one two three", 4, 2)).toEqual({
      parts: ["one ", "two "],
      includedBytes: 8,
    });
    expect(splitUtf8Context("text", 4, 0)).toEqual({ parts: [], includedBytes: 0 });
    expect(splitUtf8Context("text", 0, 2)).toEqual({ parts: [], includedBytes: 0 });
  });
});
