import { describe, expect, it } from "vitest";
import {
  forkCandidatesFromItems,
  lastCompletedAssistantDialoguesByTurn,
  latestImplementablePlanTargetFromItems,
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

  it("selects the last eligible outcome with original item identity and first-seen turn order", () => {
    const first = assistantDialogue("first", "assistantResponse", "completed", "one");
    const second = assistantDialogue("second", "assistantResponse", "completed", "two");
    const plan = assistantDialogue("plan", "proposedPlan", "completed", "one");
    const items = [
      first,
      second,
      plan,
      userMessage("user", "request", "one"),
      { id: "tool", kind: "tool" as const, role: "tool" as const, text: "work", turnId: "two" },
      assistantDialogue("draft-plan", "proposedPlan", "streaming", "two"),
      assistantDialogue("draft", "assistantResponse", "streaming", "two"),
    ];
    const outcomes = lastCompletedAssistantDialoguesByTurn(items);
    expect([...outcomes.keys()]).toEqual(["one", "two"]);
    expect(outcomes.get("one")).toBe(plan);
    expect(outcomes.get("two")).toBe(second);
    expect(latestImplementablePlanTargetFromItems(items)).toEqual({ itemId: "plan" });
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
