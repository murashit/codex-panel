import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { referencedThreadContextBundle, referencedThreadMetadataFromPrompt } from "../../../src/domain/threads/reference";
import { referencedThreadV1Fixture } from "../../helpers/referenced-thread-v1";

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
  it("builds an untruncated reference prompt with the 20 turn limit noted", () => {
    const longText = "x".repeat(5000);
    const prompt = referencedThreadV1Fixture(thread(), [{ userText: longText, assistantText: "回答" }], "この続きです");

    expect(prompt).toContain("[Codex Panel referenced thread v1]");
    expect(prompt).toContain('"version":1');
    expect(prompt).toContain('"includedTurns":1');
    expect(prompt).toContain('"turnLimit":20');
    expect(prompt).toContain(longText);
    expect(prompt).toContain("Current user request:\nこの続きです");
  });

  it("extracts display text and metadata from a reference prompt", () => {
    const prompt = referencedThreadV1Fixture(thread(), [{ userText: "元の依頼", assistantText: "回答" }], "この続きです");

    expect(referencedThreadMetadataFromPrompt(prompt)).toEqual({
      text: "この続きです",
      reference: {
        threadId: "019abcde-0000-7000-8000-000000000001",
        title: "参照元",
        includedTurns: 1,
        turnLimit: 20,
      },
    });
  });

  it("does not parse the old line-based reference prompt format", () => {
    expect(
      referencedThreadMetadataFromPrompt(
        [
          "[Codex Panel referenced thread]",
          "Title: 参照元",
          "Thread ID: thread-ref",
          "Included turns: 1/20",
          "",
          "Reference thread history:",
          "",
          "Turn 1:",
          "User:",
          "元の依頼",
          "",
          "[/Codex Panel referenced thread]",
          "",
          "Current user request:",
          "この続きです",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("rejects malformed or unsupported reference envelopes", () => {
    expect(
      referencedThreadMetadataFromPrompt(
        [
          "[Codex Panel referenced thread v1]",
          "{not-json}",
          "",
          "Reference thread history:",
          "",
          "[/Codex Panel referenced thread]",
          "",
          "Current user request:",
          "この続きです",
        ].join("\n"),
      ),
    ).toBeNull();

    expect(
      referencedThreadMetadataFromPrompt(
        [
          "[Codex Panel referenced thread v1]",
          '{"version":2,"threadId":"thread-ref","title":"参照元","includedTurns":1,"turnLimit":20}',
          "",
          "Reference thread history:",
          "",
          "[/Codex Panel referenced thread]",
          "",
          "Current user request:",
          "この続きです",
        ].join("\n"),
      ),
    ).toBeNull();
  });

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

  it("recovers a legacy v1 envelope when referenced history contains its markers", () => {
    const nested = referencedThreadV1Fixture(
      thread({ id: "inner", name: "Inner" }),
      [{ userText: "inner request", assistantText: "inner answer" }],
      "nested visible request",
    );
    const outer = referencedThreadV1Fixture(thread(), [{ userText: nested, assistantText: "outer answer" }], "outer visible request");

    expect(referencedThreadMetadataFromPrompt(outer)?.text).toBe("outer visible request");
  });

  it("preserves a legacy visible request containing the request marker", () => {
    const prompt = referencedThreadV1Fixture(
      thread(),
      [{ userText: "old", assistantText: "answer" }],
      "before\nCurrent user request:\nafter",
    );

    expect(referencedThreadMetadataFromPrompt(prompt)?.text).toBe("before\nCurrent user request:\nafter");
  });
});
