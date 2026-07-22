import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "../../../src/domain/chat/context-budget";
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
    canAcceptDirectInput: null,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

describe("thread reference context", () => {
  it("keeps the newest complete turns within the reference budget", () => {
    const turns = [
      {
        messages: [
          { kind: "user" as const, text: `old-${"a".repeat(10_000)}` },
          { kind: "assistant" as const, text: "old answer" },
        ],
      },
      {
        messages: [
          { kind: "user" as const, text: `middle-${"b".repeat(10_000)}` },
          { kind: "assistant" as const, text: "middle answer" },
        ],
      },
      {
        messages: [
          { kind: "user" as const, text: "new request" },
          { kind: "assistant" as const, text: "new answer" },
        ],
      },
    ];
    const context = referencedThreadContext(thread(), { turns, earlierTurnsAvailable: true });

    expect(context).toContain("new request");
    expect(context).toContain("middle-");
    expect(context).not.toContain("old-");
    expect(context).toContain("Included recent turns: 2");
    expect(context).toContain("Omitted fetched turns due to size: 1");
    expect(context).toContain("Earlier turns not fetched: yes");
  });

  it("keeps all dialogue roles when the newest turn itself exceeds the budget", () => {
    const context = referencedThreadContext(thread(), {
      turns: [
        {
          messages: [
            { kind: "user", text: `large-user-${"u".repeat(30_000)}` },
            { kind: "assistant", text: `draft-answer-${"d".repeat(2_000)}` },
            { kind: "user", text: "corrected requirement" },
            { kind: "assistant", text: `final-answer-${"a".repeat(2_000)}` },
          ],
        },
      ],
      earlierTurnsAvailable: false,
    });

    expect(context).toContain("large-user-");
    expect(context).toContain("User follow-up:\ncorrected requirement");
    expect(context).toContain("final-answer-");
    expect(context).toContain("[Turn dialogue truncated]");
    expect(context).toContain("Earlier turns not fetched: no");
  });

  it("keeps the first and latest dialogue within the byte budget when a turn has many messages", () => {
    const messages = Array.from({ length: 1_200 }, (_, index) => ({
      kind: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `${String(index)}-${"内容".repeat(100)}`,
    }));
    const context = referencedThreadContext(thread(), {
      turns: [{ messages }],
      earlierTurnsAvailable: false,
    });

    expect(utf8ByteLength(context)).toBeLessThanOrEqual(18_500);
    expect(context).toContain("0-");
    expect(context).toContain("1199-");
    expect(context).toContain("dialogue messages omitted from the middle");
  });
});
