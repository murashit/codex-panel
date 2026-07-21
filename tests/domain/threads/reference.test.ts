import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { referencedThreadContext } from "../../../src/domain/threads/reference";

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
    const context = referencedThreadContext(thread(), turns);

    expect(context).toContain("new request");
    expect(context).toContain("middle-");
    expect(context).not.toContain("old-");
    expect(context).toContain("Included turns: 2");
    expect(context).toContain("Omitted turns: 1");
  });

  it("keeps both fields when the newest turn itself exceeds the budget", () => {
    const context = referencedThreadContext(thread(), [
      { userText: `large-user-${"u".repeat(30_000)}`, assistantText: `final-answer-${"a".repeat(2_000)}` },
    ]);

    expect(context).toContain("large-user-");
    expect(context).toContain("final-answer-");
    expect(context).toContain("[Turn fields truncated]");
  });
});
