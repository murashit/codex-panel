import { describe, expect, it } from "vitest";
import {
  completedTurnTranscriptSummaryFromTurnRecord,
  lastAgentMessageTextFromTurnRecord,
  referencedThreadTurnsFromNewestFirstTurnRecords,
  type TurnItem,
  transcriptEntriesFromTurnRecords,
} from "../../../src/app-server/protocol/turn";
import {
  appServerAgentMessageFixture as agentMessage,
  appServerCompletedTurnFixture as turn,
  appServerUserMessageFixture as userMessage,
} from "../../support/app-server-records";

describe("app-server turn records", () => {
  it("projects readable transcript entries without command log items", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([userMessage("u1", "  Request  "), commandItem("cmd"), agentMessage("a1", "Response"), planItem("p1", "Plan")], {
          startedAt: 10,
          completedAt: 12,
        }),
      ]),
    ).toEqual([
      { kind: "user", text: "Request", timestamp: 10 },
      { kind: "assistant", text: "Response", timestamp: 12 },
      { kind: "plan", text: "Plan", timestamp: 12 },
    ]);
  });

  it("builds completed turn transcript summaries from the first user message and last assistant-like item", () => {
    expect(
      completedTurnTranscriptSummaryFromTurnRecord(
        turn([
          agentMessage("draft", "Progress update"),
          userMessage("u1", "Initial request"),
          userMessage("u2", "Follow-up"),
          agentMessage("a1", "Final response"),
          planItem("p1", "Final plan"),
        ]),
      ),
    ).toEqual({ userText: "Initial request", assistantText: "Final plan" });
  });

  it("does not build completed turn transcript summaries for failed turns", () => {
    expect(
      completedTurnTranscriptSummaryFromTurnRecord(
        turn([userMessage("u1", "Request"), agentMessage("a1", "Response")], { status: "failed" }),
      ),
    ).toBeNull();
  });

  it("requires both user and assistant text for a completed turn summary", () => {
    expect(completedTurnTranscriptSummaryFromTurnRecord(turn([userMessage("u1", "Request")]))).toBeNull();
    expect(completedTurnTranscriptSummaryFromTurnRecord(turn([agentMessage("a1", "Response")]))).toBeNull();
  });

  it("projects transcript entries from turn lists", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([userMessage("u1", "Earlier request")], { id: "turn-1", startedAt: 10 }),
        turn([agentMessage("a1", "Later response")], { id: "turn-2", startedAt: 20, completedAt: 25 }),
      ]),
    ).toEqual([
      { kind: "user", text: "Earlier request", timestamp: 10 },
      { kind: "assistant", text: "Later response", timestamp: 25 },
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
              { type: "text", text: "Look at this image", text_elements: [] },
              { type: "localImage", path: "Codex Attachments/diagram.png" },
              { type: "image", url: "https://example.com/diagram.png" },
            ],
          },
        ]),
      ]),
    ).toEqual([
      {
        kind: "user",
        text: "Look at this image\n[local image] Codex Attachments/diagram.png\n[image] https://example.com/diagram.png",
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

  it("shows an image attachment without exposing its app-server file ID", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([{ type: "userMessage", id: "u1", clientId: null, content: [{ type: "image", fileId: "file-123" }] }]),
      ]),
    ).toEqual([{ kind: "user", text: "[image]", timestamp: null }]);
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

  it("keeps native plugin mentions when a user message has no visible text", () => {
    expect(
      transcriptEntriesFromTurnRecords([
        turn([{ type: "userMessage", id: "u1", clientId: null, content: [{ type: "mention", name: "sample", path: "plugin://sample" }] }]),
      ]),
    ).toEqual([{ kind: "user", text: "[@sample] plugin://sample", timestamp: null }]);
  });

  it("extracts the final non-empty agent message text from a turn", () => {
    expect(
      lastAgentMessageTextFromTurnRecord(
        turn([
          agentMessage("a1", '{"replacementText":"first"}'),
          agentMessage("a2", "  "),
          agentMessage("a3", '{"replacementText":"final"}'),
          agentMessage("a4", "  "),
        ]),
      ),
    ).toBe('{"replacementText":"final"}');
  });

  it("returns null when a turn has no agent message text", () => {
    expect(lastAgentMessageTextFromTurnRecord(turn([agentMessage("a1", "  ")]))).toBeNull();
  });
});

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
