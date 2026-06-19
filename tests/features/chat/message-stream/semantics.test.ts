import { describe, expect, it } from "vitest";

import { messageStreamItemFromTurnItem } from "../../../../src/features/chat/app-server/mappers/message-stream/turn-items";
import {
  messageStreamIsAutoReviewDecision,
  messageStreamSemanticClassifications,
} from "../../../../src/features/chat/domain/message-stream/semantics";
import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";
import type { TurnItem } from "../../../../src/app-server/protocol/turn";

describe("message stream semantic classification", () => {
  it("separates dialogue meaning from turn placement", () => {
    const semantic = messageStreamSemanticClassifications([
      userMessage("u1", "do it", "turn"),
      userMessage("u2", "also check tests", "turn"),
      {
        id: "a1",
        kind: "message",
        messageKind: "assistantResponse",
        messageState: "completed",
        role: "assistant",
        text: "done",
        turnId: "turn",
      },
    ]);

    expect(semantic.map(({ meaning }) => meaning)).toEqual([
      { plane: "dialogue", event: "request" },
      { plane: "dialogue", event: "request" },
      { plane: "dialogue", event: "response" },
    ]);
    expect(semantic.map(({ placement }) => placement)).toEqual([
      { scope: "turn", turnId: "turn", turnRole: "initiator" },
      { scope: "turn", turnId: "turn", turnRole: "steer" },
      { scope: "turn", turnId: "turn", turnRole: "outcome" },
    ]);
    expect(semantic[2]?.capabilities).toMatchObject({ isTurnOutcome: true, canForkFromHere: true });
  });

  it("uses local steer provenance before falling back to turn order", () => {
    const semantic = messageStreamSemanticClassifications([
      userMessage("u1", "do it", "turn", "local-user-1"),
      userMessage("u2", "also check tests", "turn", "local-steer-1"),
      userMessage("u3", "and docs", "turn", null),
      {
        ...userMessage("u4", "late steer without prompt", "turn-without-prompt", null),
        provenance: { source: "localUser", channel: "optimistic", interaction: "steer", sourceId: "u4" },
      },
    ]);

    expect(semantic.map(({ placement }) => ("turnRole" in placement ? placement.turnRole : null))).toEqual([
      "initiator",
      "steer",
      "steer",
      "steer",
    ]);
  });

  it("does not treat local user client ids as steering by prefix alone", () => {
    const semantic = messageStreamSemanticClassifications([
      userMessage("u1", "do it", "turn", "local-user-1"),
      userMessage("u2", "new turn", "next-turn", "local-user-2"),
    ]);

    expect(semantic.map(({ placement }) => ("turnRole" in placement ? placement.turnRole : null))).toEqual(["initiator", "initiator"]);
  });

  it("classifies message stream item meaning independently from payload shape", () => {
    const semantic = messageStreamSemanticClassifications([
      commandItem("cmd"),
      {
        id: "patch",
        kind: "fileChange",
        role: "tool",
        status: "completed",
        changes: [{ kind: "update", path: "src/main.ts", diff: "@@" }],
        executionState: "completed",
      },
      { id: "tool", kind: "tool", role: "tool", text: "tool", toolCall: { arguments: { k: "v" } } },
      { id: "hook", kind: "hook", role: "tool", text: "hook" },
      { id: "reasoning", kind: "reasoning", role: "tool", text: "thinking" },
      { id: "wait", kind: "wait", role: "tool", text: "Waited 2.5s", executionState: "completed" },
    ]);

    expect(semantic.map(({ meaning }) => meaning)).toEqual([
      { plane: "execution", event: "evidence" },
      { plane: "workspace", event: "result" },
      { plane: "execution", event: "evidence" },
      { plane: "execution", event: "evidence" },
      { plane: "execution", event: "progress" },
      { plane: "execution", event: "progress" },
    ]);
  });

  it("classifies thread and interaction events by meaning", () => {
    const semantic = messageStreamSemanticClassifications([
      { id: "goal", kind: "goal", role: "tool", text: "set: Ship it", action: "set" },
      {
        id: "approval",
        kind: "approvalResult",
        role: "tool",
        text: "Approved",
        approval: { status: "allowed", scope: "turn", request: "Approval", auditFacts: [] },
      },
      { id: "input", kind: "userInputResult", role: "tool", text: "Answered", questions: [] },
      { id: "review", kind: "reviewResult", role: "tool", text: "Review completed" },
      { id: "compact", kind: "contextCompaction", role: "tool" },
      { id: "system", kind: "system", role: "system", text: "Disconnected" },
    ]);

    expect(semantic.map(({ meaning }) => meaning)).toEqual([
      { plane: "context", event: "stateChange" },
      { plane: "permission", event: "decision" },
      { plane: "interaction", event: "response" },
      { plane: "review", event: "result" },
      { plane: "context", event: "stateChange" },
      { plane: "diagnostic", event: "notice" },
    ]);
    expect(semantic.map(({ placement }) => placement)).toEqual([
      { scope: "thread" },
      { scope: "panel" },
      { scope: "panel" },
      { scope: "panel" },
      { scope: "thread" },
      { scope: "panel" },
    ]);
  });

  it("classifies automatic review results as permission decisions", () => {
    const semantic = messageStreamSemanticClassifications([
      {
        id: "parsed-review",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved",
        provenance: { source: "panel", channel: "notice", reason: "parsedAutoReview", sourceId: "parsed-review" },
      },
      {
        id: "notification-review",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved",
        provenance: { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: "review-1" },
      },
    ]);

    expect(semantic.map(({ meaning }) => meaning)).toEqual([
      { plane: "permission", event: "decision" },
      { plane: "permission", event: "decision" },
    ]);
    expect(semantic.map(messageStreamIsAutoReviewDecision)).toEqual([true, true]);
  });

  it("marks completed proposed plans as implementable turn outcomes", () => {
    const [draft, completed] = messageStreamSemanticClassifications([
      {
        id: "draft",
        kind: "message",
        messageKind: "proposedPlan",
        messageState: "streaming",
        role: "assistant",
        text: "draft",
        turnId: "turn",
      },
      {
        id: "plan",
        kind: "message",
        messageKind: "proposedPlan",
        messageState: "completed",
        role: "assistant",
        text: "plan",
        turnId: "turn",
      },
    ]);

    expect(draft).toMatchObject({
      meaning: { plane: "dialogue", event: "proposal" },
      placement: { scope: "turn", turnRole: "detail" },
      lifecycle: { state: "running" },
      capabilities: { canImplementPlan: false, isTurnOutcome: false },
    });
    expect(completed).toMatchObject({
      meaning: { plane: "dialogue", event: "proposal" },
      placement: { scope: "turn", turnRole: "outcome" },
      lifecycle: { state: "completed" },
      capabilities: { canImplementPlan: true, isTurnOutcome: true },
    });
  });

  it("classifies sub-agent execution summaries as coordination progress", () => {
    const item = messageStreamItemFromTurnItem(collabAgentToolCall(), "turn");
    const [classification] = messageStreamSemanticClassifications(item ? [item] : []);

    expect(classification).toMatchObject({
      provenance: { source: "appServer", channel: "turnItem", itemType: "collabAgentToolCall", itemId: "agent-1" },
      placement: { scope: "turn", turnId: "turn", turnRole: "detail" },
      meaning: { plane: "coordination", event: "progress" },
    });
  });
});

function userMessage(id: string, text: string, turnId: string, clientId?: string | null): MessageStreamItem {
  return { id, kind: "message", messageKind: "user", role: "user", text, turnId, ...(clientId ? { clientId } : {}) };
}

function commandItem(id: string): MessageStreamItem {
  return {
    id,
    kind: "command",
    role: "tool",
    commandAction: "command",
    commandTarget: { kind: "command", commandLine: "npm test" },
    command: "npm test",
    cwd: "/vault",
    status: "completed",
    executionState: "completed",
  };
}

function collabAgentToolCall(): TurnItem {
  return {
    id: "agent-1",
    type: "collabAgentToolCall",
    status: "inProgress",
    tool: "spawnAgent",
    senderThreadId: "main",
    receiverThreadIds: ["sub"],
    prompt: "investigate",
    model: null,
    reasoningEffort: null,
    agentsStates: {
      sub: { status: "running", message: "reading files" },
    },
  };
}
