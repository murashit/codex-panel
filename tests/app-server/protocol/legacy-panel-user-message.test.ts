import { describe, expect, it } from "vitest";

import { legacyPanelUserMessageProjection } from "../../../src/app-server/protocol/legacy-panel-user-message";
import {
  type TurnItem,
  type TurnRecord,
  transcriptEntriesFromTurnRecords,
  turnUserItemProjection,
} from "../../../src/app-server/protocol/turn";
import { archivedThreadMarkdown } from "../../../src/domain/threads/archive-markdown";
import type { Thread } from "../../../src/domain/threads/model";
import { threadDisplayTitle } from "../../../src/domain/threads/title";
import type { TurnTranscriptSummary } from "../../../src/domain/threads/transcript";
import { threadStreamItemFromTurnItem } from "../../../src/features/chat/app-server/mappers/thread-stream/turn-items";
import { legacyTurnContextManifestText } from "../../support/legacy-turn-context-manifest";

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

function referencedThreadV1Fixture(thread: Thread, turns: readonly TurnTranscriptSummary[], userRequest: string): string {
  return [
    "[Codex Panel referenced thread v1]",
    JSON.stringify({
      version: 1,
      threadId: thread.id,
      title: threadDisplayTitle(thread),
      includedTurns: turns.length,
      turnLimit: 20,
    }),
    "",
    "Reference thread history:",
    ...turns.flatMap((turn, index) => {
      const lines = [`Turn ${String(index + 1)}:`];
      if (turn.userText) lines.push(`User:\n${turn.userText}`);
      if (turn.assistantText) lines.push(`Codex:\n${turn.assistantText}`);
      return ["", ...lines];
    }),
    "",
    "[/Codex Panel referenced thread]",
    "",
    "Current user request:",
    userRequest,
  ].join("\n");
}

function legacyProjection(text: string) {
  return legacyPanelUserMessageProjection({ content: [{ type: "text" }], visibleText: text });
}

describe("legacy Codex Panel user-message compatibility", () => {
  it("extracts display text and metadata from a v1 /refer envelope", () => {
    const prompt = referencedThreadV1Fixture(thread(), [{ userText: "元の依頼", assistantText: "回答" }], "この続きです");

    expect(legacyProjection(prompt)).toMatchObject({
      text: "この続きです",
      referencedThread: {
        threadId: "019abcde-0000-7000-8000-000000000001",
        title: "参照元",
        includedTurns: 1,
        turnLimit: 20,
      },
    });
  });

  it("rejects malformed, unsupported, and pre-v1 /refer envelopes", () => {
    const envelope = (header: string, metadata: string) =>
      [
        header,
        metadata,
        "",
        "Reference thread history:",
        "",
        "[/Codex Panel referenced thread]",
        "",
        "Current user request:",
        "この続きです",
      ].join("\n");

    expect(legacyProjection(envelope("[Codex Panel referenced thread]", "")).referencedThread).toBeNull();
    expect(legacyProjection(envelope("[Codex Panel referenced thread v1]", "{not-json}")).referencedThread).toBeNull();
    expect(
      legacyProjection(
        envelope(
          "[Codex Panel referenced thread v1]",
          '{"version":2,"threadId":"thread-ref","title":"参照元","includedTurns":1,"turnLimit":20}',
        ),
      ).referencedThread,
    ).toBeNull();
  });

  it("finds the outer boundary when referenced history contains v1 markers", () => {
    const nested = referencedThreadV1Fixture(
      thread({ id: "inner", name: "Inner" }),
      [{ userText: "inner request", assistantText: "inner answer" }],
      "nested visible request",
    );
    const outer = referencedThreadV1Fixture(thread(), [{ userText: nested, assistantText: "outer answer" }], "outer visible request");

    expect(legacyProjection(outer).text).toBe("outer visible request");
  });

  it("preserves a visible request containing the request marker", () => {
    const prompt = referencedThreadV1Fixture(
      thread(),
      [{ userText: "old", assistantText: "answer" }],
      "before\nCurrent user request:\nafter",
    );

    expect(legacyProjection(prompt).text).toBe("before\nCurrent user request:\nafter");
  });

  it("recovers bare Vault paths but rejects tool URLs", () => {
    expect(
      legacyPanelUserMessageProjection({
        content: [
          { type: "mention", name: "Old", path: "notes/Old.md" },
          { type: "mention", name: "Drive", path: "app://google-drive" },
        ],
        visibleText: "",
      }).fileReferences,
    ).toEqual([{ name: "Old", path: "notes/Old.md" }]);
  });

  it("preserves persisted content order when recovered mentions and attachments are mixed", () => {
    expect(
      turnUserItemProjection({
        type: "userMessage",
        id: "u1",
        clientId: null,
        content: [
          { type: "mention", name: "Old", path: "notes/Old.md" },
          { type: "localImage", path: "attachments/diagram.png" },
          { type: "skill", name: "review", path: "skills/review.md" },
        ],
      }).text,
    ).toBe("[file] notes/Old.md\n[local image] attachments/diagram.png\n[$review] skills/review.md");
  });

  it("does not apply legacy heuristics when a valid v2 manifest is present", () => {
    const clientId = "local-user-1-seed-1-1";
    const envelope = referencedThreadV1Fixture(
      thread({ id: "legacy-thread" }),
      [{ userText: "元の依頼", assistantText: "元の回答" }],
      "この続きです",
    );
    const manifest = legacyTurnContextManifestText({
      version: 2,
      submissionId: clientId,
      contexts: [
        {
          kind: "web",
          id: `${clientId}.01`,
          parts: 1,
          sourceBytes: 10,
          includedBytes: 10,
          truncated: false,
        },
      ],
      fileReferences: [{ name: "Current", path: "notes/Current.md" }],
    });

    expect(
      turnUserItemProjection({
        type: "userMessage",
        id: "u1",
        clientId,
        content: [
          { type: "text", text: envelope, text_elements: [] },
          { type: "mention", name: "Old", path: "notes/Old.md" },
          { type: "text", text: `\n${manifest}`, text_elements: [] },
        ],
      }),
    ).toEqual({
      text: envelope,
      referencedThread: null,
      fileReferences: [{ name: "Current", path: "notes/Current.md" }],
      contexts: [{ kind: "web", truncated: false }],
    });
  });

  it("keeps recovered file references visible and deduplicated", () => {
    const userMessage: TurnItem = {
      type: "userMessage",
      id: "u1",
      clientId: "local-user-1-seed-1-1",
      content: [
        { type: "text", text: "Read [[Alpha]] and [[Beta]].", text_elements: [] },
        { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
        { type: "mention", name: "Alpha duplicate", path: "thoughts/Alpha.md" },
        { type: "mention", name: "Beta", path: "thoughts/Beta.md" },
      ],
    };

    expect(threadStreamItemFromTurnItem(userMessage)).toMatchObject({
      text: "Read [[Alpha]] and [[Beta]].",
      referencedFiles: [
        { name: "Alpha", path: "thoughts/Alpha.md" },
        { name: "Beta", path: "thoughts/Beta.md" },
      ],
    });
  });

  it("keeps the active-file marker distinct from an equivalent recovered path", () => {
    const userMessage: TurnItem = {
      type: "userMessage",
      id: "u1",
      clientId: "local-user-1-seed-1-1",
      content: [
        { type: "text", text: "Read [[Alpha]].", text_elements: [] },
        { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
        { type: "mention", name: "<active>", path: "thoughts/Alpha.md" },
      ],
    };

    expect(threadStreamItemFromTurnItem(userMessage)).toMatchObject({
      referencedFiles: [
        { name: "Alpha", path: "thoughts/Alpha.md" },
        { name: "Active file", path: "thoughts/Alpha.md" },
      ],
    });
  });

  it("renders a recovered Vault path for an empty-text message", () => {
    const userMessage: TurnItem = {
      type: "userMessage",
      id: "u1",
      clientId: null,
      content: [{ type: "mention", name: "設計メモ", path: "メモ/設計.md" }],
    };

    expect(threadStreamItemFromTurnItem(userMessage)).toMatchObject({
      text: "[file] メモ/設計.md",
      copyText: "[file] メモ/設計.md",
      referencedFiles: [{ name: "設計メモ", path: "メモ/設計.md" }],
    });
  });

  it("normalizes a persisted v1 /refer envelope before presentation", () => {
    const text = referencedThreadV1Fixture(
      thread({ id: "thread-reference" }),
      [
        { userText: "元の依頼", assistantText: "元の回答" },
        { userText: "次の依頼", assistantText: "次の回答" },
      ],
      "この続きです",
    );

    expect(
      threadStreamItemFromTurnItem({
        type: "userMessage",
        id: "u1",
        clientId: null,
        content: [{ type: "text", text, text_elements: [] }],
      }),
    ).toMatchObject({
      text: "この続きです",
      copyText: "この続きです",
      referencedThread: {
        threadId: "thread-reference",
        title: "参照元",
        includedTurns: 2,
        turnLimit: 20,
      },
    });
  });

  it("normalizes a persisted v1 /refer envelope before archive rendering", () => {
    const text = referencedThreadV1Fixture(
      thread({ id: "thread-reference" }),
      [{ userText: "元の依頼", assistantText: "元の回答" }],
      "この続きです",
    );
    const turn: TurnRecord = {
      id: "turn-1",
      items: [
        {
          type: "userMessage",
          id: "user-1",
          clientId: null,
          content: [{ type: "text", text, text_elements: [] }],
        },
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
    };

    const markdown = archivedThreadMarkdown({
      ...thread(),
      transcriptEntries: transcriptEntriesFromTurnRecords([turn]),
    });

    expect(markdown).toContain("この続きです");
    expect(markdown).toContain("> Referenced: 参照元 (1/20 turns, thread-reference)");
    expect(markdown).not.toContain("Reference thread history:");
    expect(markdown).not.toContain("元の依頼");
  });
});
