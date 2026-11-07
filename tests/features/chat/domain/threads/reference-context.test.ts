import { describe, expect, it } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import { referencedThreadContext } from "../../../../../src/features/chat/domain/threads/reference-context";
import { panelThreadFixture } from "../../../../support/panel-thread";

function thread(overrides: Partial<Thread> = {}): Thread {
  return panelThreadFixture({
    id: "019abcde-0000-7000-8000-000000000001",
    preview: "Preview",
    name: "Referenced thread",
    ...overrides,
  });
}

describe("thread reference context", () => {
  it("preserves turn order and identifies user, follow-up, assistant, and plan messages", () => {
    const context = referencedThreadContext(thread(), {
      turns: [
        {
          messages: [
            { kind: "user", text: "Initial request" },
            { kind: "assistant", text: "First answer" },
          ],
        },
        {
          messages: [
            { kind: "user", text: "Next request" },
            { kind: "plan", text: "Proposed steps" },
            { kind: "user", text: "Correction" },
          ],
        },
      ],
      earlierTurnsAvailable: false,
    });

    expect(context).toContain("Thread: 019abcde-0000-7000-8000-000000000001");
    expect(context).toContain("Included turn 1:\nUser:\nInitial request\nCodex:\nFirst answer");
    expect(context).toContain("Included turn 2:\nUser:\nNext request\nCodex plan:\nProposed steps\nUser follow-up:\nCorrection");
    expect(context.indexOf("Initial request")).toBeLessThan(context.indexOf("Next request"));
    expect(context).toContain("Omitted fetched turns due to size: 0");
  });

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

    for (const message of turns.slice(1).flatMap((turn) => turn.messages)) {
      expect(context).toContain(message.text);
    }
    expect(context).not.toContain("old-");
    expect(context).toContain("Omitted fetched turns due to size: 1");
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
    const firstRequest = "Translate the report into Japanese, preserving the 17:00 deadline.";
    const latestAnswer = "The revised report is ready; the deadline remains 17:00.";
    const messages = Array.from({ length: 1_200 }, (_, index) => ({
      kind: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `Dialogue [${String(index).padStart(4, "0")}]: ${index === 0 ? firstRequest : index === 1_199 ? latestAnswer : "内容".repeat(100)}`,
    }));
    const context = referencedThreadContext(thread(), {
      turns: [{ messages }],
      earlierTurnsAvailable: false,
    });

    const retainedDialogue = [...context.matchAll(/Dialogue \[(\d+)\]:/g)].map((match) => Number(match[1]));
    expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(18_500);
    expect(context).toContain(`Dialogue [0000]: ${firstRequest}`);
    expect(context).toContain(`Dialogue [1199]: ${latestAnswer}`);
    expect(retainedDialogue).toEqual([...new Set(retainedDialogue)].sort((left, right) => left - right));
    const omittedMessageCount = context.match(/(\d+) dialogue messages omitted from the middle/)?.[1];
    expect(omittedMessageCount).toBe(String(messages.length - retainedDialogue.length));
  });
});
