import { describe, expect, it } from "vitest";

import { codexThreadHref, codexThreadIdFromHref, threadReferenceMarkdown } from "../../../src/domain/threads/deep-link";
import type { Thread } from "../../../src/domain/threads/model";

describe("Codex thread deep links", () => {
  it("round-trips an opaque thread id", () => {
    const threadId = "019abcde-0000-7000-8000-000000000001";

    expect(codexThreadIdFromHref(codexThreadHref(threadId))).toBe(threadId);
  });

  it.each(["https://example.com", "codex://threads/", "codex://threads/a/b", "codex://threads/a?view=1"])(
    "rejects a non-thread or decorated href: %s",
    (href) => {
      expect(codexThreadIdFromHref(href)).toBeNull();
    },
  );

  it("rejects malformed encoding and excessively long thread ids", () => {
    expect(codexThreadIdFromHref("codex://threads/%E0%A4%A")).toBeNull();
    expect(codexThreadIdFromHref(codexThreadHref("x".repeat(1_000)))).toBeNull();
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
