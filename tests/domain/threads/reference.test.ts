import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import {
  referencedThreadDisplayFromPrompt,
  referencedThreadInput,
  referencedThreadPrompt,
  referencedThreadTurns,
} from "../../../src/domain/threads/reference";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: "参照元",
    archived: false,
    ...overrides,
  };
}

describe("thread reference context", () => {
  it("uses supplied conversation summaries as referenced turns", () => {
    const turns = referencedThreadTurns([
      { userText: "最初の依頼", assistantText: "最終回答" },
      { userText: "次の依頼", assistantText: "次の回答" },
    ]);

    expect(turns).toEqual([
      { userText: "最初の依頼", assistantText: "最終回答" },
      { userText: "次の依頼", assistantText: "次の回答" },
    ]);
  });

  it("builds an untruncated reference prompt with the 20 turn limit noted", () => {
    const longText = "x".repeat(5000);
    const prompt = referencedThreadPrompt(thread(), [{ userText: longText, assistantText: "回答" }], "この続きです");

    expect(prompt).toContain("[Codex Panel referenced thread v1]");
    expect(prompt).toContain('"version":1');
    expect(prompt).toContain('"includedTurns":1');
    expect(prompt).toContain('"turnLimit":20');
    expect(prompt).toContain(longText);
    expect(prompt).toContain("Current user request:\nこの続きです");
  });

  it("extracts display text and metadata from a reference prompt", () => {
    const prompt = referencedThreadPrompt(thread(), [{ userText: "元の依頼", assistantText: "回答" }], "この続きです");

    expect(referencedThreadDisplayFromPrompt(prompt)).toEqual({
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
      referencedThreadDisplayFromPrompt(
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
      referencedThreadDisplayFromPrompt(
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
      referencedThreadDisplayFromPrompt(
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

  it("builds slash command input while preserving non-text attachments", () => {
    const source = thread();
    const input = referencedThreadInput(source, [{ userText: "元の依頼", assistantText: "回答" }], "この続きです", [
      { type: "text", text: "この続きです", text_elements: [] },
      { type: "mention", name: "Note", path: "Note.md" },
    ]);

    expect(input.status).toBe("Referencing 019abcde (1/20 turns).");
    expect(input.referencedThread).toMatchObject({ threadId: source.id, title: "参照元", includedTurns: 1 });
    expect(input.input[0]).toMatchObject({ type: "text" });
    expect(input.input[1]).toEqual({ type: "mention", name: "Note", path: "Note.md" });
  });
});
