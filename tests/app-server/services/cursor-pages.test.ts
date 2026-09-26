import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { collectCursorPages } from "../../../src/app-server/services/cursor-pages";

describe("collectCursorPages", () => {
  it("collects every page once in cursor order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.array(fc.integer(), { maxLength: 5 }), { minLength: 1, maxLength: 8 }), async (pages) => {
        let index = 0;
        const readPage = vi.fn(async (cursor: string | null) => {
          expect(cursor).toBe(index === 0 ? null : `page-${index}`);
          const data = pages[index];
          if (!data) throw new Error("Unexpected page read");
          index += 1;
          return { data, nextCursor: index < pages.length ? `page-${index}` : null };
        });

        await expect(collectCursorPages(readPage, "model list")).resolves.toEqual(pages.flat());
        expect(readPage).toHaveBeenCalledTimes(pages.length);
      }),
    );
  });

  it("rejects a cursor cycle after reading each distinct cursor once", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.nat(), async (length, repeatedIndex) => {
        const repeat = repeatedIndex % length;
        let reads = 0;
        const readPage = vi.fn(async (cursor: string | null) => {
          expect(cursor).toBe(reads === 0 ? null : `page-${reads - 1}`);
          if (reads > length) throw new Error("Unexpected page read");
          const nextCursor = reads < length ? `page-${reads}` : `page-${repeat}`;
          reads += 1;
          return { data: [reads], nextCursor };
        });

        await expect(collectCursorPages(readPage, "model list")).rejects.toThrow("repeated model list cursor");
        expect(readPage).toHaveBeenCalledTimes(length + 1);
      }),
    );
  });
});
