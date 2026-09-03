import { describe, expect, it } from "vitest";

import {
  chronologicalTurnTranscriptSummariesFromTurnRecords,
  completedTurnTranscriptSummaryFromTurnRecord,
  lastAgentMessageTextFromTurnRecord,
  referencedThreadTurnsFromNewestFirstTurnRecords,
  type TurnItem,
  type TurnRecord,
  transcriptEntriesFromTurnRecords,
  turnTranscriptAssistantTextFromTurnRecord,
} from "../../../src/app-server/protocol/turn";

describe("app-server turn records", () => {
  it("projects readable transcript entries without command log items", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([userMessage("u1", "  依頼です  "), commandItem("cmd"), agentMessage("a1", "回答です"), planItem("p1", "計画です")], {
          startedAt: 10,
          completedAt: 12,
        }),
      ]),
    ).toEqual([
      { kind: "user", text: "依頼です", timestamp: 10 },
      { kind: "assistant", text: "回答です", timestamp: 12 },
      { kind: "plan", text: "計画です", timestamp: 12 },
    ]);
  });

  it("builds completed turn transcript summaries from the first user message and last assistant-like item", () => {
    expect(
      completedTurnTranscriptSummaryFromTurnRecord(
        turn([
          agentMessage("draft", "途中経過"),
          userMessage("u1", "最初の依頼"),
          userMessage("u2", "補足"),
          agentMessage("a1", "最終回答"),
        ]),
      ),
    ).toEqual({ userText: "最初の依頼", assistantText: "最終回答" });
  });

  it("does not build completed turn transcript summaries for failed turns", () => {
    expect(
      completedTurnTranscriptSummaryFromTurnRecord(turn([userMessage("u1", "依頼"), agentMessage("a1", "回答")], { status: "failed" })),
    ).toBeNull();
  });

  it("requires both user and assistant text for a completed turn summary", () => {
    expect(completedTurnTranscriptSummaryFromTurnRecord(turn([userMessage("u1", "依頼")]))).toBeNull();
    expect(completedTurnTranscriptSummaryFromTurnRecord(turn([agentMessage("a1", "回答")]))).toBeNull();
  });

  it("returns chronological turn transcript summaries and drops turns without transcript text", () => {
    expect(
      chronologicalTurnTranscriptSummariesFromTurnRecords([
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

  it("reverses the app-server newest-first page without reordering equal timestamps", () => {
    expect(
      referencedThreadTurnsFromNewestFirstTurnRecords([
        turn([userMessage("new", "newest")], { id: "new", startedAt: null }),
        turn([userMessage("middle", "middle")], { id: "middle", startedAt: null }),
        turn([userMessage("old", "oldest")], { id: "old", startedAt: null }),
      ]).map((turn) => turn.messages[0]?.text),
    ).toEqual(["oldest", "middle", "newest"]);
  });

  it("omits referenced turns that contain no readable transcript entries", () => {
    expect(referencedThreadTurnsFromNewestFirstTurnRecords([turn([commandItem("cmd")])])).toEqual([]);
  });

  it("sorts missing turn start times before dated turns", () => {
    expect(
      chronologicalTurnTranscriptSummariesFromTurnRecords([
        turn([userMessage("dated", "dated"), agentMessage("dated-a", "dated-answer")], { startedAt: 10 }),
        turn([userMessage("missing", "missing"), agentMessage("missing-a", "missing-answer")], { startedAt: null }),
      ]),
    ).toEqual([
      { userText: "missing", assistantText: "missing-answer" },
      { userText: "dated", assistantText: "dated-answer" },
    ]);
  });

  it("keeps local image attachments out of user transcript text when text is present", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [
              { type: "text", text: "![[Codex Attachments/diagram.png]]", text_elements: [] },
              { type: "localImage", path: "Codex Attachments/diagram.png" },
            ],
          },
        ]),
      ]),
    ).toEqual([{ kind: "user", text: "![[Codex Attachments/diagram.png]]", timestamp: null }]);
  });

  it("keeps image attachment stubs when user text does not contain the image reference", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [
              { type: "text", text: "この画像を見てください", text_elements: [] },
              { type: "localImage", path: "Codex Attachments/diagram.png" },
              { type: "image", url: "https://example.com/diagram.png" },
            ],
          },
        ]),
      ]),
    ).toEqual([
      {
        kind: "user",
        text: "この画像を見てください\n[local image] Codex Attachments/diagram.png\n[image] https://example.com/diagram.png",
        timestamp: null,
      },
    ]);
  });

  it("omits image attachments already represented by visible text", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [
              { type: "text", text: "https://example.com/diagram.png", text_elements: [] },
              { type: "image", url: "https://example.com/diagram.png" },
            ],
          },
        ]),
      ]),
    ).toEqual([{ kind: "user", text: "https://example.com/diagram.png", timestamp: null }]);
  });

  it("keeps skill references when a user message has no visible text", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([
          {
            type: "userMessage",
            id: "u1",
            clientId: null,
            content: [{ type: "skill", name: "review", path: "/skills/review" }],
          },
        ]),
      ]),
    ).toEqual([{ kind: "user", text: "[$review] /skills/review", timestamp: null }]);
  });

  it("extracts assistant-like transcript text for generated turn consumers", () => {
    expect(turnTranscriptAssistantTextFromTurnRecord(turn([userMessage("u1", "依頼"), planItem("p1", "計画")]))).toBe("計画");
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
    expect(lastAgentMessageTextFromTurnRecord(turn([agentMessage("only", "only answer")]))).toBe("only answer");
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
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null, delivery: null, questions: null };
}

function planItem(id: string, text: string): TurnItem {
  return { type: "plan", id, text };
}

function commandItem(id: string): TurnItem {
  return {
    type: "commandExecution",
    id,
    pluginId: null,
    scriptPath: null,
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
