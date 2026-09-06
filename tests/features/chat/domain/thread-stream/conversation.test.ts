import { describe, expect, it } from "vitest";
import {
  forkCandidatesFromItems,
  isCompletedPlanCandidate,
  isCompletedTurnOutcomeDialogue,
  lastTurnOutcomeItemsByTurn,
  threadStreamUserRoles,
} from "../../../../../src/features/chat/domain/thread-stream/conversation";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("shared conversation rules", () => {
  it("preserves supplied order and local steer provenance without consuming the first prompt slot", () => {
    const explicitSteer: ThreadStreamItem = {
      ...userMessage("explicit", "steer", "turn"),
      provenance: { source: "localUser", channel: "optimistic", interaction: "steer", sourceId: "explicit" },
    };
    const items = [
      explicitSteer,
      userMessage("first", "prompt", "turn"),
      userMessage("other", "other prompt", "other", "local-user-1"),
      userMessage("second", "steer", "turn"),
      assistantDialogue("response", "assistantResponse", "completed", "turn"),
    ];
    expect(threadStreamUserRoles(items)).toEqual(["steer", "initiator", "initiator", "steer", null]);
    // A partial history is classified from the supplied items, without inferring a missing prompt.
    expect(threadStreamUserRoles(items.slice(3))).toEqual(["initiator", null]);
  });

  it("counts client-id steers but only honors their prefix within a turn", () => {
    expect(
      threadStreamUserRoles([
        userMessage("steer", "steer", "turn", "local-steer-1"),
        userMessage("later", "later", "turn"),
        userMessage("pending", "pending", "", "local-steer-2"),
        {
          ...userMessage("explicit", "steer", ""),
          provenance: { source: "localUser", channel: "optimistic", interaction: "steer", sourceId: "explicit" },
        },
      ]),
    ).toEqual(["steer", "steer", "initiator", "steer"]);
  });

  it("preserves execution-state precedence and the difference between plan and outcome eligibility", () => {
    const cases = [
      { kind: "assistantResponse", state: "completed", execution: undefined, turn: "turn", outcome: true, plan: false },
      { kind: "assistantResponse", state: "completed", execution: null, turn: "turn", outcome: true, plan: false },
      { kind: "assistantResponse", state: "completed", execution: "running", turn: "turn", outcome: false, plan: false },
      { kind: "assistantResponse", state: "completed", execution: "failed", turn: "turn", outcome: false, plan: false },
      { kind: "assistantResponse", state: "streaming", execution: "completed", turn: "turn", outcome: false, plan: false },
      { kind: "assistantResponse", state: "completed", execution: "completed", turn: undefined, outcome: false, plan: false },
      { kind: "proposedPlan", state: "completed", execution: undefined, turn: "turn", outcome: true, plan: true },
      { kind: "proposedPlan", state: "completed", execution: null, turn: undefined, outcome: false, plan: true },
      { kind: "proposedPlan", state: "streaming", execution: "completed", turn: "turn", outcome: false, plan: true },
      { kind: "proposedPlan", state: "streaming", execution: undefined, turn: "turn", outcome: false, plan: false },
      { kind: "proposedPlan", state: "completed", execution: "failed", turn: "turn", outcome: false, plan: false },
    ] as const;
    for (const { kind, state, execution, turn, outcome, plan } of cases) {
      const item: ThreadStreamItem = {
        ...assistantDialogue("candidate", kind, state, turn),
        ...(execution !== undefined ? { executionState: execution } : {}),
      };
      expect(isCompletedPlanCandidate(item), JSON.stringify(item)).toBe(plan);
      expect(isCompletedTurnOutcomeDialogue(item), JSON.stringify(item)).toBe(outcome);
    }
    expect(isCompletedTurnOutcomeDialogue(userMessage("user", "request", "turn"))).toBe(false);
    expect(isCompletedPlanCandidate(userMessage("user", "request", "turn"))).toBe(false);
  });

  it("selects the last eligible outcome with original item identity and first-seen turn order", () => {
    const first = assistantDialogue("first", "assistantResponse", "completed", "one");
    const second = assistantDialogue("second", "assistantResponse", "completed", "two");
    const plan = assistantDialogue("plan", "proposedPlan", "completed", "one");
    const items = [
      first,
      second,
      plan,
      { ...first, id: "failed", executionState: "failed" as const },
      assistantDialogue("draft", "assistantResponse", "streaming", "two"),
    ];
    const outcomes = lastTurnOutcomeItemsByTurn(items);
    expect([...outcomes.keys()]).toEqual(["one", "two"]);
    expect(outcomes.get("one")).toBe(plan);
    expect(outcomes.get("two")).toBe(second);
    expect(forkCandidatesFromItems(items)).toEqual([
      { itemId: "plan", turnId: "one" },
      { itemId: "second", turnId: "two" },
    ]);
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

describe("thread stream item selectors", () => {
  it("selects final assistant messages as fork candidates", () => {
    const streamItems = threadStreamItems();

    const candidates = forkCandidatesFromItems(streamItems);

    expect(candidates).toEqual([
      { itemId: "a1", turnId: "turn-1" },
      { itemId: "a2", turnId: "turn-2" },
      { itemId: "a3", turnId: "turn-3" },
    ]);
  });
});

function threadStreamItems(): ThreadStreamItem[] {
  return [
    { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "first", turnId: "turn-1" },
    {
      id: "a1",
      kind: "dialogue",
      role: "assistant",
      text: "first answer",
      turnId: "turn-1",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "tool-1", kind: "tool", role: "tool", text: "work", turnId: "turn-2" },
    {
      id: "a2-delta",
      kind: "dialogue",
      role: "assistant",
      text: "draft",
      turnId: "turn-2",
      dialogueKind: "proposedPlan",
      dialogueState: "streaming",
    },
    {
      id: "a2",
      kind: "dialogue",
      role: "assistant",
      text: "second answer",
      turnId: "turn-2",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u3", kind: "dialogue", dialogueKind: "user", role: "user", text: "third", turnId: "turn-3" },
    {
      id: "a3",
      kind: "dialogue",
      role: "assistant",
      text: "third answer",
      turnId: "turn-3",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
  ];
}
