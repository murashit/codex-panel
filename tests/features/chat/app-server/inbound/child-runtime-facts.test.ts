import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import { planChatInboundNotification } from "../../../../../src/features/chat/app-server/inbound/notification-plan";
import {
  type RuntimeFactSource,
  turnRuntimeFactsFromNotification,
} from "../../../../../src/features/chat/app-server/inbound/runtime-fact-adapter";
import type { ChatState } from "../../../../../src/features/chat/application/state/model";
import { chatReducer } from "../../../../../src/features/chat/application/state/reducer";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

describe("normalized child runtime facts", () => {
  it("preserves summary/body delta sources and suppresses only child body deltas", () => {
    const summary = {
      method: "item/reasoning/summaryTextDelta",
      params: { ...childScope, itemId: "reasoning", summaryIndex: 0, delta: "Summary" },
    } satisfies RuntimeFactSource;
    const body = {
      method: "item/reasoning/textDelta",
      params: { ...childScope, itemId: "reasoning", contentIndex: 0, delta: "Body" },
    } satisfies RuntimeFactSource;
    const part = {
      method: "item/reasoning/summaryPartAdded",
      params: { ...childScope, itemId: "reasoning", summaryIndex: 0 },
    } satisfies RuntimeFactSource;

    expect(facts(summary)).toMatchObject([{ type: "textDelta", source: "summary", delta: "Summary" }]);
    expect(facts(body)).toMatchObject([{ type: "textDelta", source: "body", delta: "Body" }]);
    expect(facts(part)).toMatchObject([{ type: "textDelta", source: "summary", delta: "" }]);

    let child = receive(trackedParent(), part);
    expect(preview(child)).toMatchObject({ id: "reasoning", kind: "reasoning" });
    child = receive(child, summary);
    expect(preview(child)).toMatchObject({ text: "reasoning: Summary" });
    expect(receive(child, body).activeTurn.subagents).toBe(child.activeTurn.subagents);

    let parent = receive(runningParent(), { ...summary, params: { ...summary.params, ...parentScope } });
    parent = receive(parent, { ...body, params: { ...body.params, ...parentScope } });
    expect(chatStateThreadStreamItems(parent)).toMatchObject([{ text: "reasoning: SummaryBody" }]);

    child = receive(child, completedReasoning("reasoning"));
    expect(preview(child)).toMatchObject({ text: "Summary\n\nBody" });
  });

  it("distinguishes item start, content update, and task progress without adapter preview policy", () => {
    const started = {
      method: "item/started",
      params: { ...childScope, startedAtMs: 1, item: { type: "fileChange", id: "patch", status: "inProgress", changes: [] } },
    } satisfies RuntimeFactSource;
    const patch = {
      method: "item/fileChange/patchUpdated",
      params: { ...childScope, itemId: "patch", changes: [{ path: "note.md", kind: { type: "add" }, diff: "+content" }] },
    } satisfies RuntimeFactSource;
    const task = {
      method: "turn/plan/updated",
      params: { ...childScope, explanation: "Review", plan: [{ step: "Check changes", status: "inProgress" }] },
    } satisfies RuntimeFactSource;
    expect(facts(started)).toMatchObject([{ type: "itemStarted" }]);
    expect(facts(patch)).toMatchObject([{ type: "itemContentUpdated" }]);
    expect(facts(task)).toMatchObject([{ type: "taskProgressUpdated" }]);

    let state = receive(trackedParent(), started);
    state = receive(state, patch);
    expect(preview(state)).toMatchObject({ id: "patch", changes: [{ diff: "+content" }] });
    state = receive(state, assistantDelta("newer"));
    state = receive(state, patch);
    expect(preview(state)).toMatchObject({ id: "newer" });
    state = receive(state, started);
    expect(preview(state)).toMatchObject({ id: "patch" });
    state = receive(state, task);
    expect(preview(state)).toMatchObject({ kind: "taskProgress" });

    let parent = runningParent();
    parent = receive(parent, { ...started, params: { ...started.params, ...parentScope } });
    parent = receive(parent, { ...patch, params: { ...patch.params, ...parentScope } });
    parent = receive(parent, { ...task, params: { ...task.params, ...parentScope } });
    expect(chatStateThreadStreamItems(parent)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "patch", changes: [expect.objectContaining({ diff: "+content" })] }),
        expect.objectContaining({ kind: "taskProgress" }),
      ]),
    );
  });

  it("does not advance a newer preview for old item completion, but uses canonical turn completion", () => {
    let state = receive(trackedParent(), assistantDelta("newer"));
    state = receive(state, completedReasoning("older"));
    expect(preview(state)).toMatchObject({ id: "newer" });
    state = receive(state, {
      method: "turn/completed",
      params: {
        threadId: "child",
        turn: {
          ...childTurn,
          status: "completed",
          items: [{ type: "reasoning", id: "reasoning", summary: ["Canonical summary"], content: ["Canonical body"] }],
        },
      },
    });
    expect(preview(state)).toMatchObject({ id: "reasoning", text: "Canonical summary\n\nCanonical body" });
    expect(state.activeTurn.subagents.byThreadId.get("child")).toMatchObject({ liveness: "stopped", outcome: "completed" });
  });

  it("ignores older child turn updates, including completed canonical items", () => {
    let state = receive(trackedParent(), { method: "turn/started", params: { threadId: "child", turn: { ...childTurn, id: "new-turn" } } });
    state = receive(state, { ...assistantDelta("current"), params: { ...assistantDelta("current").params, turnId: "new-turn" } });
    const before = state.activeTurn.subagents;
    state = receive(state, assistantDelta("old"));
    state = receive(state, completedReasoning("old"));
    state = receive(state, { method: "turn/completed", params: { threadId: "child", turn: { ...childTurn, status: "completed" } } });
    expect(state.activeTurn.subagents).toBe(before);
  });

  it("requires a tracked child and running parent, and drops activity after the parent scope changes", () => {
    const notification = assistantDelta("child-answer");
    expect(planChatInboundNotification(runningParent(), notification, localId).actions).toEqual([]);
    let state = trackedParent();
    const plan = planChatInboundNotification(state, notification, localId);
    expect(plan.actions).toEqual([{ type: "subagent-activity/runtime-fact", threadId: "child", fact: facts(notification)[0] }]);

    const idle = chatStateWith(state, { activeTurn: { lifecycle: { kind: "idle" } } });
    expect(plan.actions.reduce(chatReducer, idle).activeTurn.subagents).toBe(idle.activeTurn.subagents);
    state = chatReducer(state, { type: "turn/started", threadId: "parent", turnId: "next-parent-turn", items: [] });
    expect(state.activeTurn.subagents.byThreadId.size).toBe(0);
    expect(plan.actions.reduce(chatReducer, state).activeTurn.subagents).toBe(state.activeTurn.subagents);
    expect(planChatInboundNotification(state, notification, localId).actions).toEqual([]);
  });

  it("leaves the child preview unchanged for raw command output", () => {
    const state = receive(trackedParent(), assistantDelta("current"));
    expect(
      receive(state, {
        method: "item/commandExecution/outputDelta",
        params: { ...childScope, itemId: "command", delta: "raw output" },
      }).activeTurn.subagents,
    ).toBe(state.activeTurn.subagents);
  });
});

const childScope = { threadId: "child", turnId: "child-turn" };
const parentScope = { threadId: "parent", turnId: "parent-turn" };
const childTurn: Extract<ServerNotification, { method: "turn/started" }>["params"]["turn"] = {
  id: "child-turn",
  status: "inProgress",
  error: null,
  startedAt: 1,
  completedAt: null,
  durationMs: null,
  itemsView: "full",
  items: [],
};

function runningParent(): ChatState {
  return chatStateFixture({ activeThread: { id: "parent" }, activeTurn: { lifecycle: { kind: "running", turnId: "parent-turn" } } });
}

function trackedParent(): ChatState {
  return chatReducer(runningParent(), { type: "subagent-activity/tracked", threadId: "child", parentTurnId: "parent-turn" });
}

function localId(prefix: string): string {
  return prefix;
}
function facts(notification: RuntimeFactSource) {
  return turnRuntimeFactsFromNotification(notification, localId);
}
function receive(state: ChatState, notification: ServerNotification): ChatState {
  return planChatInboundNotification(state, notification, localId).actions.reduce(chatReducer, state);
}
function preview(state: ChatState) {
  return state.activeTurn.subagents.byThreadId.get("child")?.latestItem;
}
function assistantDelta(itemId: string) {
  return { method: "item/agentMessage/delta", params: { ...childScope, itemId, delta: "Current work" } } satisfies RuntimeFactSource;
}
function completedReasoning(itemId: string) {
  return {
    method: "item/completed",
    params: { ...childScope, completedAtMs: 2, item: { type: "reasoning", id: itemId, summary: ["Summary"], content: ["Body"] } },
  } satisfies RuntimeFactSource;
}
