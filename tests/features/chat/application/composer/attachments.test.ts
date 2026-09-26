import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { codexInputWithComposerAttachments } from "../../../../../src/features/chat/application/composer/attachments";

describe("composer attachment input", () => {
  it("includes active attachments once per path and input type", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.integer({ min: 0, max: 6 }),
            kind: fc.constantFrom("file" as const, "image" as const),
            active: fc.boolean(),
          }),
          { maxLength: 20 },
        ),
        fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 4 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 4 }),
        (entries, existingFiles, existingImages) => {
          const attachments = entries.map((entry, index) => ({
            kind: entry.kind,
            name: `attachment-${index}`,
            path: `Attachments/${entry.path}.png`,
            marker: `![[marker-${index}]]`,
          }));
          const text = entries.flatMap((entry, index) => (entry.active ? [`![[marker-${index}]]`] : [])).join(" ");
          const input = [
            { type: "text" as const, text },
            ...existingFiles.map((path) => ({ type: "fileReference" as const, name: String(path), path: `Attachments/${path}.png` })),
            ...existingImages.map((path) => ({ type: "localImage" as const, path: `Attachments/${path}.png` })),
          ];
          const result = codexInputWithComposerAttachments(text, input, attachments);
          const active = entries.filter((entry) => entry.active);
          const expectedFiles = [...new Set([...existingFiles, ...active.map((entry) => entry.path)])].map(
            (path) => `Attachments/${path}.png`,
          );
          const expectedImages = [
            ...new Set([...existingImages, ...active.filter((entry) => entry.kind === "image").map((entry) => entry.path)]),
          ].map((path) => `Attachments/${path}.png`);
          expect(result.filter((item) => item.type === "fileReference").map((item) => item.path)).toEqual(expectedFiles);
          expect(result.filter((item) => item.type === "localImage").map((item) => item.path)).toEqual(expectedImages);
          expect(result[0]).toEqual({ type: "text", text });
        },
      ),
    );
  });

  it("adds image data without duplicating a file already resolved from its wikilink", () => {
    const path = "Attachments/diagram.png";
    const text = `Explain ![[${path}]]`;
    const reference = { type: "fileReference" as const, name: "diagram", path };

    expect(
      codexInputWithComposerAttachments(
        text,
        [{ type: "text", text }, reference],
        [{ kind: "image", name: "diagram", path, marker: `![[${path}]]` }],
      ),
    ).toEqual([{ type: "text", text }, reference, { type: "localImage", path }]);
  });
});
