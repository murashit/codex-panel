import { describe, expect, it } from "vitest";

import {
  chronologicalConversationSummariesFromAppServerTurns,
  completedConversationSummaryFromAppServerTurn,
  lastAgentMessageTextFromAppServerTurn,
  transcriptEntriesFromAppServerTurn,
} from "../../src/app-server/turn-model";
import type { ThreadItem } from "../../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../../src/generated/app-server/v2/Turn";

describe("app-server turn model", () => {
  it("projects readable transcript entries without command log items", () => {
    expect(
      transcriptEntriesFromAppServerTurn(
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
      completedConversationSummaryFromAppServerTurn(
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
      completedConversationSummaryFromAppServerTurn(turn([userMessage("u1", "依頼"), agentMessage("a1", "回答")], { status: "failed" })),
    ).toBeNull();
  });

  it("returns chronological summaries and drops turns without conversation text", () => {
    expect(
      chronologicalConversationSummariesFromAppServerTurns([
        turn([userMessage("u2", "後の依頼"), agentMessage("a2", "後の回答")], { id: "turn-2", startedAt: 20 }),
        turn([commandItem("cmd")], { id: "turn-empty", startedAt: 15 }),
        turn([userMessage("u1", "先の依頼"), agentMessage("a1", "先の回答")], { id: "turn-1", startedAt: 10 }),
      ]),
    ).toEqual([
      { userText: "先の依頼", assistantText: "先の回答" },
      { userText: "後の依頼", assistantText: "後の回答" },
    ]);
  });

  it("extracts the final non-empty agent message text from a turn", () => {
    expect(
      lastAgentMessageTextFromAppServerTurn(
        turn([
          agentMessage("a1", '{"replacementText":"first"}'),
          agentMessage("a2", "  "),
          agentMessage("a3", '{"replacementText":"final"}'),
        ]),
      ),
    ).toBe('{"replacementText":"final"}');
  });

  it("returns null when a turn has no agent message text", () => {
    expect(lastAgentMessageTextFromAppServerTurn(turn([agentMessage("a1", "  ")]))).toBeNull();
  });
});

function turn(items: Turn["items"], overrides: Partial<Turn> = {}): Turn {
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

function userMessage(id: string, text: string): ThreadItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function agentMessage(id: string, text: string): ThreadItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

function planItem(id: string, text: string): ThreadItem {
  return { type: "plan", id, text };
}

function commandItem(id: string): ThreadItem {
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
