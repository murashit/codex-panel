import { describe, expect, it } from "vitest";
import {
  initialSubagentActivityState,
  reduceSubagentActivitySlice,
} from "../../../../../src/features/chat/application/state/subagent-activity";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("subagent activity state", () => {
  it("tracks a child and accumulates its active reasoning summary", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/tracked",
      threadId: "child",
      parentTurnId: "parent-turn",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-started",
      threadId: "child",
      childTurnId: "child-turn",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/text-delta-appended",
      threadId: "child",
      childTurnId: "child-turn",
      itemId: "reasoning",
      label: "reasoning",
      delta: "Inspecting ",
      kind: "reasoning",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/text-delta-appended",
      threadId: "child",
      childTurnId: "child-turn",
      itemId: "reasoning",
      label: "reasoning",
      delta: "routing",
      kind: "reasoning",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      childTurnId: "child-turn",
      latestItem: { id: "reasoning", kind: "reasoning", text: "reasoning: Inspecting routing" },
    });
  });

  it("does not let an older item completion replace a newer activity", () => {
    let state = trackedState();
    state = observe(state, reasoningItem("older", "Reading files"), true);
    state = observe(state, reasoningItem("newer", "Running tests"), true);
    state = observe(state, { ...reasoningItem("older", "Finished reading"), executionState: "completed" }, false);

    expect(state.byThreadId.get("child")?.latestItem).toMatchObject({
      id: "newer",
      text: "Running tests",
    });
  });

  it("uses the last displayable canonical item when the child turn completes", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-completed",
      threadId: "child",
      childTurnId: "child-turn",
      items: [
        { id: "user", kind: "dialogue", dialogueKind: "user", role: "user", text: "work" },
        reasoningItem("reasoning", "Done checking"),
        {
          id: "answer",
          kind: "dialogue",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
          role: "assistant",
          text: "Everything passes.",
        },
      ],
      executionState: "completed",
    });

    expect(state.byThreadId.get("child")?.latestItem).toMatchObject({
      id: "answer",
      text: "Everything passes.",
    });
  });

  it("ignores delayed notifications from an older child turn", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-started",
      threadId: "child",
      childTurnId: "new-turn",
    });
    state = observe(state, reasoningItem("current", "Current work", "new-turn"), true);
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/text-delta-appended",
      threadId: "child",
      childTurnId: "old-turn",
      itemId: "stale",
      label: "reasoning",
      delta: "Older work",
      kind: "reasoning",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/turn-completed",
      threadId: "child",
      childTurnId: "old-turn",
      items: [reasoningItem("stale", "Older work", "old-turn")],
      executionState: "completed",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      childTurnId: "new-turn",
      executionState: "running",
      latestItem: { id: "current", text: "Current work" },
    });
  });
});

function trackedState() {
  return reduceSubagentActivitySlice(initialSubagentActivityState(), {
    type: "subagent-activity/tracked",
    threadId: "child",
    parentTurnId: "parent-turn",
  });
}

function observe(state: ReturnType<typeof trackedState>, item: ThreadStreamItem, advance: boolean): ReturnType<typeof trackedState> {
  return reduceSubagentActivitySlice(state, {
    type: "subagent-activity/item-observed",
    threadId: "child",
    item,
    advance,
  });
}

function reasoningItem(id: string, text: string, turnId = "child-turn"): ThreadStreamItem {
  return { id, kind: "reasoning", role: "tool", turnId, text };
}
