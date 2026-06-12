import { describe, expect, it } from "vitest";

import {
  chronologicalConversationSummariesFromTurnRecords,
  completedConversationSummariesFromTurnRecords,
  completedConversationSummaryFromTurnRecord,
  conversationAssistantTextFromTurnRecord,
  lastAgentMessageTextFromTurnRecord,
  transcriptEntriesFromTurnRecords,
  transcriptEntriesFromTurnRecord,
  type TurnItem,
  type TurnRecord,
} from "../../src/app-server/protocol/turn";

describe("app-server turn records", () => {
  it("projects readable transcript entries without command log items", () => {
    expect(
      transcriptEntriesFromTurnRecord(
        turn([userMessage("u1", "  依頼です  "), commandItem("cmd"), agentMessage("a1", "回答です"), planItem("p1", "計画です")], {
          startedAt: 10,
          completedAt: 12,
        }),
      ),
    ).toEqual([
      { kind: "user", text: "依頼です", timestamp: 10 },
      { kind: "assistant", text: "回答です", timestamp: 12 },
      { kind: "plan", text: "計画です", timestamp: 12 },
    ]);
  });

  it("builds completed turn summaries from the first user message and last assistant-like item", () => {
    expect(
      completedConversationSummaryFromTurnRecord(
        turn([
          agentMessage("draft", "途中経過"),
          userMessage("u1", "最初の依頼"),
          userMessage("u2", "補足"),
          agentMessage("a1", "最終回答"),
        ]),
      ),
    ).toEqual({ userText: "最初の依頼", assistantText: "最終回答" });
  });

  it("does not build completed summaries for failed turns", () => {
    expect(
      completedConversationSummaryFromTurnRecord(turn([userMessage("u1", "依頼"), agentMessage("a1", "回答")], { status: "failed" })),
    ).toBeNull();
  });

  it("projects completed summaries from turn lists without exposing filtering logic to callers", () => {
    expect(
      completedConversationSummariesFromTurnRecords([
        turn([userMessage("u1", "依頼"), agentMessage("a1", "回答")], { id: "completed" }),
        turn([userMessage("u2", "失敗した依頼"), agentMessage("a2", "失敗した回答")], { id: "failed", status: "failed" }),
        turn([commandItem("cmd")], { id: "empty" }),
      ]),
    ).toEqual([{ userText: "依頼", assistantText: "回答" }]);
  });

  it("returns chronological summaries and drops turns without conversation text", () => {
    expect(
      chronologicalConversationSummariesFromTurnRecords([
        turn([userMessage("u2", "後の依頼"), agentMessage("a2", "後の回答")], { id: "turn-2", startedAt: 20 }),
        turn([commandItem("cmd")], { id: "turn-empty", startedAt: 15 }),
        turn([userMessage("u1", "先の依頼"), agentMessage("a1", "先の回答")], { id: "turn-1", startedAt: 10 }),
      ]),
    ).toEqual([
      { userText: "先の依頼", assistantText: "先の回答" },
      { userText: "後の依頼", assistantText: "後の回答" },
    ]);
  });

  it("projects transcript entries from turn lists", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([userMessage("u1", "先の依頼")], { id: "turn-1", startedAt: 10 }),
        turn([agentMessage("a1", "後の回答")], { id: "turn-2", startedAt: 20, completedAt: 25 }),
      ]),
    ).toEqual([
      { kind: "user", text: "先の依頼", timestamp: 10 },
      { kind: "assistant", text: "後の回答", timestamp: 25 },
    ]);
  });

  it("extracts assistant-like conversation text for generated turn consumers", () => {
    expect(conversationAssistantTextFromTurnRecord(turn([userMessage("u1", "依頼"), planItem("p1", "計画")]))).toBe("計画");
  });

  it("extracts the final non-empty agent message text from a turn", () => {
    expect(
      lastAgentMessageTextFromTurnRecord(
        turn([
          agentMessage("a1", '{"replacementText":"first"}'),
          agentMessage("a2", "  "),
          agentMessage("a3", '{"replacementText":"final"}'),
        ]),
      ),
    ).toBe('{"replacementText":"final"}');
  });

  it("returns null when a turn has no agent message text", () => {
    expect(lastAgentMessageTextFromTurnRecord(turn([agentMessage("a1", "  ")]))).toBeNull();
  });
});

function turn(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    ...overrides,
  };
}

function userMessage(id: string, text: string): TurnItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function agentMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

function planItem(id: string, text: string): TurnItem {
  return { type: "plan", id, text };
}

function commandItem(id: string): TurnItem {
  return {
    type: "commandExecution",
    id,
    command: "npm test",
    cwd: "/vault",
    processId: null,
    source: "agent",
    status: "completed",
    commandActions: [],
    aggregatedOutput: "ignored",
    exitCode: 0,
    durationMs: 1,
  };
}
