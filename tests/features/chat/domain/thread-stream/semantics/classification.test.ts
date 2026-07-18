import { describe, expect, it } from "vitest";
import type { TurnItem } from "../../../../../../src/app-server/protocol/turn";
import { streamingFileChangeThreadStreamItem } from "../../../../../../src/features/chat/app-server/mappers/thread-stream/file-changes";
import { threadStreamItemFromTurnItem } from "../../../../../../src/features/chat/app-server/mappers/thread-stream/turn-items";
import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";
import { threadStreamReasoningIsActive } from "../../../../../../src/features/chat/domain/thread-stream/semantics/active-turn";
import { threadStreamSemanticClassifications } from "../../../../../../src/features/chat/domain/thread-stream/semantics/classify";
import { threadStreamIsAutoReviewDecision } from "../../../../../../src/features/chat/domain/thread-stream/semantics/predicates";

describe("thread stream semantic classification", () => {
  it("separates dialogue meaning from turn placement", () => {
    const semantic = threadStreamSemanticClassifications([
      userMessage("u1", "do it", "turn"),
      userMessage("u2", "also check tests", "turn"),
      {
        id: "a1",
        kind: "dialogue",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
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
    const semantic = threadStreamSemanticClassifications([
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
    const semantic = threadStreamSemanticClassifications([
      userMessage("u1", "do it", "turn", "local-user-1"),
      userMessage("u2", "new turn", "next-turn", "local-user-2"),
    ]);

    expect(semantic.map(({ placement }) => ("turnRole" in placement ? placement.turnRole : null))).toEqual(["initiator", "initiator"]);
  });

  it("classifies thread stream item meaning independently from payload shape", () => {
    const semantic = threadStreamSemanticClassifications([
      commandItem("cmd"),
      {
        id: "patch",
        kind: "fileChange",
        role: "tool",
        status: "completed",
        changes: [{ kind: "update", path: "src/main.ts", diff: "@@" }],
        executionState: "completed",
      },
      { id: "tool", kind: "tool", role: "tool", text: "tool", diagnostics: [{ title: "Arguments JSON", body: '{"k":"v"}' }] },
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

  it("classifies streaming file change patch status as lifecycle state", () => {
    const [semantic] = threadStreamSemanticClassifications([
      streamingFileChangeThreadStreamItem("patch", "turn", [{ kind: "update", path: "src/main.ts", diff: "@@\n-old\n+new" }], "inProgress"),
    ]);

    expect(semantic).toMatchObject({
      meaning: { plane: "workspace", event: "result" },
      lifecycle: { state: "running" },
    });
  });

  it("classifies thread and interaction events by meaning", () => {
    const semantic = threadStreamSemanticClassifications([
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
    const semantic = threadStreamSemanticClassifications([
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
    expect(semantic.map(threadStreamIsAutoReviewDecision)).toEqual([true, true]);
  });

  it("marks completed proposed plans as implementable turn outcomes", () => {
    const [draft, completed] = threadStreamSemanticClassifications([
      {
        id: "draft",
        kind: "dialogue",
        dialogueKind: "proposedPlan",
        dialogueState: "streaming",
        role: "assistant",
        text: "draft",
        turnId: "turn",
      },
      {
        id: "plan",
        kind: "dialogue",
        dialogueKind: "proposedPlan",
        dialogueState: "completed",
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

  it("grants turn outcome capabilities only to completed assistant dialogue outcomes in a turn", () => {
    const cases: readonly [label: string, item: ThreadStreamItem, expected: boolean][] = [
      ["completed response", assistantDialogue("completed-response", "assistantResponse", "completed", "turn"), true],
      ["completed plan", assistantDialogue("completed-plan", "proposedPlan", "completed", "turn"), true],
      ["streaming response", assistantDialogue("streaming", "assistantResponse", "streaming", "turn"), false],
      ["response outside a turn", assistantDialogue("no-turn", "assistantResponse", "completed"), false],
      ["user request", userMessage("user", "request", "turn"), false],
      ["turn detail", { ...commandItem("command"), turnId: "turn" }, false],
    ];

    for (const [label, item, expected] of cases) {
      const [classification] = threadStreamSemanticClassifications([item]);
      expect(classification?.capabilities, label).toMatchObject({
        canForkFromHere: expected,
        isTurnOutcome: expected,
      });
    }
  });

  it("allows rollback only from turn and pending-turn initiators", () => {
    const first = userMessage("first", "first", "turn");
    const steer = {
      ...userMessage("steer", "steer", "turn"),
      provenance: { source: "localUser", channel: "optimistic", interaction: "steer", sourceId: "steer" },
    } satisfies ThreadStreamItem;
    const pending: ThreadStreamItem = {
      id: "pending",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "pending",
    };
    const cases: readonly [label: string, items: readonly ThreadStreamItem[], index: number, expected: boolean][] = [
      ["turn initiator", [first], 0, true],
      ["pending-turn initiator", [pending], 0, true],
      ["explicit steer", [first, steer], 1, false],
      ["turn outcome", [assistantDialogue("response", "assistantResponse", "completed", "turn")], 0, false],
      ["turn detail", [{ ...commandItem("command"), turnId: "turn" }], 0, false],
    ];

    for (const [label, items, index, expected] of cases) {
      expect(threadStreamSemanticClassifications(items)[index]?.capabilities.canRollbackToPrompt, label).toBe(expected);
    }
  });

  it("allows implementation only for completed proposed plans", () => {
    const cases: readonly [label: string, item: ThreadStreamItem, expected: boolean][] = [
      ["completed plan", assistantDialogue("plan", "proposedPlan", "completed", "turn"), true],
      ["completed plan awaiting turn attachment", assistantDialogue("pending-plan", "proposedPlan", "completed"), true],
      ["streaming plan", assistantDialogue("draft", "proposedPlan", "streaming", "turn"), false],
      ["completed response", assistantDialogue("response", "assistantResponse", "completed", "turn"), false],
      ["non-dialogue completion", commandItem("command"), false],
    ];

    for (const [label, item, expected] of cases) {
      expect(threadStreamSemanticClassifications([item])[0]?.capabilities.canImplementPlan, label).toBe(expected);
    }
  });

  it("classifies sub-agent execution summaries as coordination progress", () => {
    const item = threadStreamItemFromTurnItem(collabAgentToolCall(), "turn");
    const [classification] = threadStreamSemanticClassifications(item ? [item] : []);

    expect(classification).toMatchObject({
      provenance: { source: "appServer", channel: "turnItem", itemType: "collabAgentToolCall", itemId: "agent-1" },
      placement: { scope: "turn", turnId: "turn", turnRole: "detail" },
      meaning: { plane: "coordination", event: "progress" },
    });
  });

  it("marks only the latest unfinished active-turn reasoning item as active", () => {
    const firstReasoning: ThreadStreamItem = { id: "r1", kind: "reasoning", role: "tool", text: "first", turnId: "turn" };
    const latestReasoning: ThreadStreamItem = { id: "r2", kind: "reasoning", role: "tool", text: "latest", turnId: "turn" };
    const otherTurnReasoning: ThreadStreamItem = { id: "r3", kind: "reasoning", role: "tool", text: "other", turnId: "other" };

    const context = { activeTurnId: "turn", items: [firstReasoning, latestReasoning, otherTurnReasoning] };

    expect(threadStreamReasoningIsActive(firstReasoning, context)).toBe(false);
    expect(threadStreamReasoningIsActive(latestReasoning, context)).toBe(true);
    expect(threadStreamReasoningIsActive(otherTurnReasoning, context)).toBe(false);
    expect(threadStreamReasoningIsActive({ ...latestReasoning, executionState: "completed" }, context)).toBe(false);
  });
});

function userMessage(id: string, text: string, turnId: string, clientId?: string | null): ThreadStreamItem {
  return { id, kind: "dialogue", dialogueKind: "user", role: "user", text, turnId, ...(clientId ? { clientId } : {}) };
}

function assistantDialogue(
  id: string,
  dialogueKind: "assistantResponse" | "proposedPlan",
  dialogueState: "streaming" | "completed",
  turnId?: string,
): ThreadStreamItem {
  return {
    id,
    kind: "dialogue",
    dialogueKind,
    dialogueState,
    role: "assistant",
    text: id,
    ...(turnId ? { turnId } : {}),
  };
}

function commandItem(id: string): ThreadStreamItem {
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
