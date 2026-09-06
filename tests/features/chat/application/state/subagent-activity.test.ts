import { describe, expect, it } from "vitest";
import {
  initialSubagentActivityState,
  reduceSubagentActivitySlice,
} from "../../../../../src/features/chat/application/state/subagent-activity";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("subagent activity state", () => {
  it("shows auth recovery as a temporary preview until child activity resumes", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "authRecoveryUpdated",
        turnId: "child-turn",
        progress: { message: "Refreshing AWS authentication.", phase: "running" },
      },
    });

    expect(state.byThreadId.get("child")?.statusPreview).toBe("Refreshing AWS authentication.");

    state = observe(state, reasoningItem("next", "Continuing", "child-turn"), true);
    expect(state.byThreadId.get("child")?.statusPreview).toBeNull();
  });

  it("keeps v2 identity, liveness, and outcome as separate facts", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "started",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interacted",
    });
    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      liveness: "running",
      outcome: null,
    });

    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interrupted",
    });
    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      liveness: "stopped",
      outcome: null,
    });
  });

  it("tracks a child and accumulates its active reasoning summary", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/tracked",
      threadId: "child",
      parentTurnId: "parent-turn",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: { type: "turnStarted", threadId: "child", turnId: "child-turn" },
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "textDelta",
        turnId: "child-turn",
        itemId: "reasoning",
        label: "reasoning",
        delta: "Inspecting ",
        kind: "reasoning",
        source: "summary",
      },
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "textDelta",
        turnId: "child-turn",
        itemId: "reasoning",
        label: "reasoning",
        delta: "routing",
        kind: "reasoning",
        source: "summary",
      },
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
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "turnCompleted",
        threadId: "child",
        turnId: "child-turn",
        completedItems: [
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
        status: "completed",
        itemsView: "full",
        completedTurnTranscriptSummary: null,
      },
    });

    expect(state.byThreadId.get("child")?.latestItem).toMatchObject({
      id: "answer",
      text: "Everything passes.",
    });
  });

  it("ignores delayed notifications from an older child turn", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: { type: "turnStarted", threadId: "child", turnId: "new-turn" },
    });
    state = observe(state, reasoningItem("current", "Current work", "new-turn"), true);
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "textDelta",
        turnId: "old-turn",
        itemId: "stale",
        label: "reasoning",
        delta: "Older work",
        kind: "reasoning",
        source: "summary",
      },
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "turnCompleted",
        threadId: "child",
        turnId: "old-turn",
        completedItems: [reasoningItem("stale", "Older work", "old-turn")],
        status: "completed",
        itemsView: "full",
        completedTurnTranscriptSummary: null,
      },
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      childTurnId: "new-turn",
      liveness: "running",
      outcome: null,
      latestItem: { id: "current", text: "Current work" },
    });
  });

  it("does not let delayed v2 lifecycle hints overwrite child turn facts", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: {
        type: "turnCompleted",
        threadId: "child",
        turnId: "child-turn",
        completedItems: [],
        status: "completed",
        itemsView: "full",
        completedTurnTranscriptSummary: null,
      },
    });
    for (const coordinationUpdate of ["started", "interrupted"] as const) {
      state = reduceSubagentActivitySlice(state, {
        type: "subagent-activity/coordination-observed",
        threadId: "child",
        parentTurnId: "parent-turn",
        agentLabel: "/root/scout",
        coordinationUpdate,
      });
    }

    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      childTurnId: "child-turn",
      liveness: "stopped",
      outcome: "completed",
    });
  });

  it("does not revive a v2 agent when started arrives after interrupted", () => {
    let state = reduceSubagentActivitySlice(initialSubagentActivityState(), {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interrupted",
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "started",
    });

    expect(state.byThreadId.get("child")).toMatchObject({ liveness: "stopped", outcome: null });
  });

  it("stops a running child immediately when v2 interruption arrives", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/runtime-fact",
      threadId: "child",
      fact: { type: "turnStarted", threadId: "child", turnId: "child-turn" },
    });
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "interrupted",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      childTurnId: "child-turn",
      agentLabel: "/root/scout",
      liveness: "stopped",
      outcome: null,
    });
  });

  it("records a v2 completion as a terminal successful outcome", () => {
    let state = trackedState();
    state = reduceSubagentActivitySlice(state, {
      type: "subagent-activity/coordination-observed",
      threadId: "child",
      parentTurnId: "parent-turn",
      agentLabel: "/root/scout",
      coordinationUpdate: "completed",
    });

    expect(state.byThreadId.get("child")).toMatchObject({
      agentLabel: "/root/scout",
      liveness: "stopped",
      outcome: "completed",
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
    type: "subagent-activity/runtime-fact",
    threadId: "child",
    fact: advance ? { type: "itemStarted", item } : { type: "itemCompleted", item, turnId: item.turnId ?? "child-turn" },
  });
}

function reasoningItem(id: string, text: string, turnId = "child-turn"): ThreadStreamItem {
  return { id, kind: "reasoning", role: "tool", turnId, text };
}
