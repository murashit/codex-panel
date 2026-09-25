import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { splitUtf8Context, truncateUtf8, utf8ByteLength } from "../../../src/domain/text/text";

const contextText = fc.oneof(
  fc.string({ unit: "binary", maxLength: 80 }),
  fc.string({ unit: fc.constantFrom("a", " ", "\n", "あ", "😀"), maxLength: 80 }),
);

describe("UTF-8 context budgets", () => {
  it.each([
    { value: "", maxBytes: 10, expected: "" },
    { value: "ascii", maxBytes: 5, expected: "ascii" },
    { value: "あい", maxBytes: 3, expected: "あ" },
    { value: "A😀B", maxBytes: 5, expected: "A😀" },
    { value: "A😀B", maxBytes: 4, expected: "A" },
  ])("truncates $value to at most $maxBytes bytes", ({ value, maxBytes, expected }) => {
    const result = truncateUtf8(value, maxBytes);

    expect(result).toBe(expected);
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
    expect(result.includedBytes).toBe(utf8ByteLength(value));
  });

  it("honors maxParts and reports only included bytes", () => {
    expect(splitUtf8Context("one two three", 4, 2)).toEqual({
      parts: ["one ", "two "],
      includedBytes: 8,
    });
    expect(splitUtf8Context("text", 4, 0)).toEqual({ parts: [], includedBytes: 0 });
  });

  it("keeps the longest complete Unicode prefix within the byte budget", () => {
    fc.assert(
      fc.property(contextText, fc.integer({ min: 0, max: 120 }), (value, maxBytes) => {
        let expected = "";
        for (const character of value) {
          if (Buffer.byteLength(expected + character, "utf8") > maxBytes) break;
          expected += character;
        }

        expect(truncateUtf8(value, maxBytes)).toBe(expected);
      }),
    );
  });

  it("splits a contiguous prefix into byte-bounded parts and reports their actual size", () => {
    fc.assert(
      fc.property(contextText, fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 8 }), (value, maxBytes, maxParts) => {
        const { parts, includedBytes } = splitUtf8Context(value, maxBytes, maxParts);

        expect(parts.length).toBeLessThanOrEqual(maxParts);
        expect(parts.every((part) => part.length > 0 && Buffer.byteLength(part, "utf8") <= maxBytes)).toBe(true);
        expect(value.startsWith(parts.join(""))).toBe(true);
        expect(includedBytes).toBe(Buffer.byteLength(parts.join(""), "utf8"));
      }),
    );
  });

  it("retains all text when the budget can fit every Unicode character", () => {
    fc.assert(
      fc.property(contextText, fc.integer({ min: 4, max: 40 }), (value, maxBytes) => {
        const { parts, includedBytes } = splitUtf8Context(value, maxBytes, Array.from(value).length);

        expect(parts.join("")).toBe(value);
        expect(includedBytes).toBe(Buffer.byteLength(value, "utf8"));
      }),
    );
  });
});
