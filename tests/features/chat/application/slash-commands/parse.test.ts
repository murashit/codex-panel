import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseWebCommandArgs } from "../../../../../src/features/chat/application/slash-commands/parse";

describe("parseWebCommandArgs", () => {
  it("preserves web URL and message content across separating whitespace", () => {
    const url = fc.string({ unit: fc.constantFrom("a", "0", "/", ":", ".", "?", "=", "&", "あ"), minLength: 1, maxLength: 40 });
    const word = fc.string({ unit: fc.constantFrom("a", "0", "あ", "😀"), minLength: 1, maxLength: 12 });
    const middle = fc.string({ unit: fc.constantFrom("a", " ", "\t", "\n", "あ"), maxLength: 20 });
    fc.assert(
      fc.property(url, word, middle, word, fc.constantFrom(" ", "\t", "\n", " \t\n"), (target, first, inside, last, separator) => {
        const message = `${first}${inside}${last}`;
        expect(parseWebCommandArgs(`${target}${separator}${message}  `)).toEqual({ url: target, message });
        expect(parseWebCommandArgs(`${target}${separator}`)).toEqual({ url: target, message: "" });
      }),
    );
  });
});
