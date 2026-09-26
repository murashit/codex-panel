import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { codexThreadIdFromHref, threadReferenceMarkdown } from "../../../src/domain/threads/links";
import type { Thread } from "../../../src/domain/threads/model";

describe("Codex thread deep links", () => {
  it("round-trips encoded thread ids written to Markdown links", () => {
    const threadId = fc.string({
      unit: fc.constantFrom("a", "0", " ", "/", "?", "#", "%", "[", "]", "(", ")", "あ", "😀"),
      minLength: 1,
      maxLength: 80,
    });
    fc.assert(
      fc.property(threadId, (id) => {
        const markdown = threadReferenceMarkdown(thread({ id, name: "Thread" }));
        const href = markdown.slice(markdown.lastIndexOf("](") + 2, -1);
        expect(codexThreadIdFromHref(href)).toBe(id);
      }),
    );
  });

  it.each(["https://example.com", "codex://threads/", "codex://threads/a/b", "codex://threads/a?view=1"])(
    "rejects a non-thread or decorated href: %s",
    (href) => {
      expect(codexThreadIdFromHref(href)).toBeNull();
    },
  );

  it("rejects malformed encoding and excessively long thread ids", () => {
    expect(codexThreadIdFromHref("codex://threads/%E0%A4%A")).toBeNull();
    expect(codexThreadIdFromHref(`codex://threads/${"x".repeat(160)}`)).toBe("x".repeat(160));
    expect(codexThreadIdFromHref(`codex://threads/${"x".repeat(161)}`)).toBeNull();
  });

  it("writes a bounded, escaped title as an ordinary Markdown link", () => {
    const title = `[Plan] ${"long ".repeat(30)}`;
    const truncated = `${title.slice(0, 93).trimEnd()}...`.replace(/[\\[\]]/g, "\\$&");

    expect(threadReferenceMarkdown(thread({ id: "thread-1", name: title }))).toBe(`[${truncated}](codex://threads/thread-1)`);
  });

  it("does not split an emoji at the title boundary", () => {
    const title = `${"a".repeat(92)}😀tail`;

    expect(threadReferenceMarkdown(thread({ id: "thread-1", name: title }))).toBe(`[${"a".repeat(92)}😀...](codex://threads/thread-1)`);
  });
});

function thread(overrides: Partial<Thread>): Thread {
  return {
    id: "thread",
    preview: "",
    name: null,
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}
