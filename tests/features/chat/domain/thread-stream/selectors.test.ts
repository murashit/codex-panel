import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { forkCandidatesFromItems } from "../../../../../src/features/chat/domain/thread-stream/selectors";

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
