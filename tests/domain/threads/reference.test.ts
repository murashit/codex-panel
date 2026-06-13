import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import {
  referencedThreadMetadataFromPrompt,
  referencedThreadPromptBundle,
  referencedThreadPrompt,
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

  it("builds a prompt bundle for slash command references", () => {
    const source = thread();
    const input = referencedThreadPromptBundle(source, [{ userText: "元の依頼", assistantText: "回答" }], "この続きです");

    expect(input.referencedThread).toMatchObject({ threadId: source.id, title: "参照元", includedTurns: 1 });
    expect(input.prompt).toContain("Current user request:\nこの続きです");
  });
});
