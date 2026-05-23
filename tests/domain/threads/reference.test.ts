import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import type { Turn } from "../../../src/generated/app-server/v2/Turn";
import { referencedThreadDisplayFromPrompt, referencedThreadPrompt, referencedThreadTurns } from "../../../src/domain/threads/reference";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    sessionId: "session-1",
    forkedFromId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    path: null,
    cwd: "/vault",
    cliVersion: "0.130.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "参照元",
    turns: [],
    ...overrides,
  } as Thread;
}

function turn(id: string, startedAt: number, items: Turn["items"]): Turn {
  return {
    id,
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt,
    completedAt: startedAt + 1,
    durationMs: 1,
  };
}

describe("thread reference context", () => {
  it("extracts user messages and final Codex responses in chronological order", () => {
    const turns = referencedThreadTurns([
      turn("turn-2", 2, [
        { type: "userMessage", id: "u2", content: [{ type: "text", text: "次の依頼", text_elements: [] }] },
        {
          type: "commandExecution",
          id: "cmd",
          command: "npm test",
          cwd: "/vault",
          processId: null,
          source: "agent",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "ignored",
          exitCode: 0,
          durationMs: 1,
        },
        { type: "agentMessage", id: "a2", text: "次の回答", phase: "final_answer", memoryCitation: null },
      ]),
      turn("turn-1", 1, [
        { type: "userMessage", id: "u1", content: [{ type: "text", text: "最初の依頼", text_elements: [] }] },
        { type: "agentMessage", id: "draft", text: "途中経過", phase: null, memoryCitation: null },
        { type: "agentMessage", id: "a1", text: "最終回答", phase: "final_answer", memoryCitation: null },
      ]),
    ]);

    expect(turns).toEqual([
      { userText: "最初の依頼", assistantText: "最終回答" },
      { userText: "次の依頼", assistantText: "次の回答" },
    ]);
  });

  it("builds an untruncated reference prompt with the 20 turn limit noted", () => {
    const longText = "x".repeat(5000);
    const prompt = referencedThreadPrompt(thread(), [{ userText: longText, assistantText: "回答" }], "この続きです");

    expect(prompt).toContain("Included turns: 1/20");
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
});
