import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { referencedThreadContextBundle } from "../../../src/domain/threads/reference";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: "参照元",
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

describe("thread reference context", () => {
  it("keeps the newest complete turns within the reference budget", () => {
    const turns = [
      { userText: `old-${"a".repeat(10_000)}`, assistantText: "old answer" },
      { userText: `middle-${"b".repeat(10_000)}`, assistantText: "middle answer" },
      { userText: "new request", assistantText: "new answer" },
    ];
    const bundle = referencedThreadContextBundle(thread(), turns);

    expect(bundle.value).toContain("new request");
    expect(bundle.value).toContain("middle-");
    expect(bundle.value).not.toContain("old-");
    expect(bundle.referencedThread).toMatchObject({
      includedTurns: 2,
      omittedTurns: 1,
      truncated: true,
    });
  });

  it("keeps both fields when the newest turn itself exceeds the budget", () => {
    const bundle = referencedThreadContextBundle(thread(), [
      { userText: `large-user-${"u".repeat(30_000)}`, assistantText: `final-answer-${"a".repeat(2_000)}` },
    ]);

    expect(bundle.value).toContain("large-user-");
    expect(bundle.value).toContain("final-answer-");
    expect(bundle.value).toContain("[Turn fields truncated]");
    expect(bundle.referencedThread).toMatchObject({ includedTurns: 1, omittedTurns: 0, truncated: true });
  });
});
