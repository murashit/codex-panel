import { describe, expect, it } from "vitest";

import { codexInputWithComposerAttachments } from "../../../../../src/features/chat/application/composer/attachments";

describe("composer attachment input", () => {
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
