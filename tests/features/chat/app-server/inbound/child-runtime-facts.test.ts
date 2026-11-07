import { describe, expect, it } from "vitest";
import type { ServerNotification } from "../../../../../src/app-server/connection/rpc-messages";
import type { TurnItem } from "../../../../../src/app-server/protocol/turn";
import { planChatInboundNotification } from "../../../../../src/features/chat/app-server/inbound/notification-plan";
import type { RuntimeFactSource } from "../../../../../src/features/chat/app-server/inbound/runtime-fact-adapter";
import type { ChatState } from "../../../../../src/features/chat/application/state/model";
import { chatReducer } from "../../../../../src/features/chat/application/state/reducer";
import { subagentActivityPreview } from "../../../../../src/features/chat/ui/thread-stream/subagent-preview";
import { appServerAgentMessageFixture, appServerTurnFixture, appServerUserMessageFixture } from "../../../../support/app-server-records";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems } from "../../support/thread-stream";

describe("normalized child runtime facts", () => {
  it("keeps child auth recovery visible through completion until normal child activity resumes", () => {
    const params = { ...childScope, provider: "aws", message: "Refreshing AWS authentication." };
    let state = receive(trackedParent(), { method: "modelProvider/authRecoveryStarted", params });
    expect(state.activeTurn.subagents.byThreadId.get("child")?.statusPreview).toBe("Refreshing AWS authentication.");

    state = receive(state, {
      method: "modelProvider/authRecoveryCompleted",
      params: { ...params, message: "Authentication refreshed." },
    });
    expect(state.activeTurn.subagents.byThreadId.get("child")?.statusPreview).toBe("Authentication refreshed.");
    state = receive(state, assistantDelta("continuing"));
    expect(state.activeTurn.subagents.byThreadId.get("child")?.statusPreview).toBeNull();
    expect(preview(state)).toMatchObject({ id: "continuing", text: "Current work" });
  });

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

    let child = receive(trackedParent(), part);
    expect(preview(child)).toMatchObject({ id: "reasoning", kind: "reasoning" });
    child = receive(child, summary);
    child = receive(child, { ...summary, params: { ...summary.params, delta: " continuation" } });
    expect(preview(child)).toMatchObject({ text: "reasoning: Summary continuation" });
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

  it("advances child activity to observed hooks and updates the same run on completion", () => {
    const started = {
      method: "hook/started",
      params: {
        ...childScope,
        run: {
          id: "hook-1",
          eventName: "userPromptSubmit",
          handlerType: "command",
          executionMode: "sync",
          scope: "turn",
          sourcePath: "/vault/.codex/hooks.json",
          source: "project",
          displayOrder: 1n,
          status: "running",
          statusMessage: "Preparing",
          startedAt: 1n,
          completedAt: null,
          durationMs: null,
          entries: [],
        },
      },
    } satisfies RuntimeFactSource;
    let state = receive(trackedParent(), assistantDelta("answer"));
    state = receive(state, started);
    expect(preview(state)).toMatchObject({ id: "hook-hook-1-1", kind: "hook", turnId: "child-turn", executionState: "running" });

    state = receive(state, {
      method: "hook/completed",
      params: {
        ...started.params,
        run: { ...started.params.run, status: "completed", statusMessage: "Ready", completedAt: 2n, durationMs: 1n },
      },
    });
    expect(preview(state)).toMatchObject({ id: "hook-hook-1-1", kind: "hook", turnId: "child-turn", executionState: "completed" });
  });

  it.each([
    {
      name: "reasoning-only",
      items: [{ type: "reasoning", id: "reasoning", summary: ["Canonical summary"], content: ["Canonical body"] }],
      expected: { id: "reasoning", text: "Canonical summary\n\nCanonical body" },
    },
    {
      name: "mixed",
      items: [
        appServerUserMessageFixture("request", "User request"),
        { type: "reasoning", id: "reasoning", summary: ["Canonical summary"], content: ["Canonical body"] },
        appServerAgentMessageFixture("answer", "Canonical answer"),
        appServerUserMessageFixture("follow-up", "User follow-up"),
      ],
      expected: { id: "answer", text: "Canonical answer" },
    },
  ] satisfies { name: string; items: TurnItem[]; expected: { id: string; text: string } }[])(
    "uses $name canonical completion without advancing the preview for old item completion",
    ({ items, expected }) => {
      let state = receive(trackedParent(), assistantDelta("newer"));
      state = receive(state, completedReasoning("older"));
      expect(preview(state)).toMatchObject({ id: "newer" });
      state = receive(state, {
        method: "turn/completed",
        params: { threadId: "child", turn: { ...childTurn, status: "completed", items } },
      });
      expect(preview(state)).toMatchObject(expected);
      expect(state.activeTurn.subagents.byThreadId.get("child")).toMatchObject({ liveness: "stopped", outcome: "completed" });
    },
  );

  it("advances a child preview to a completed plan even without plan deltas", () => {
    let state = receive(trackedParent(), completedReasoning("before-plan"));
    state = receive(state, {
      method: "item/started",
      params: { ...childScope, startedAtMs: 3, item: { type: "plan", id: "plan", text: "" } },
    });
    state = receive(state, {
      method: "item/completed",
      params: { ...childScope, completedAtMs: 4, item: { type: "plan", id: "plan", text: "Final plan" } },
    });
    state = receive(state, {
      method: "turn/completed",
      params: { threadId: "child", turn: { ...childTurn, status: "completed", itemsView: "notLoaded", items: [] } },
    });

    expect(subagentActivityPreview(preview(state) ?? null, "/vault")).toBe("Final plan");
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
    expect(preview(receive(state, notification))).toMatchObject({ id: "child-answer", text: "Current work" });

    const idle = chatStateWith(state, { activeTurn: { lifecycle: { kind: "idle" } } });
    expect(plan.actions.reduce(chatReducer, idle).activeTurn.subagents).toBe(idle.activeTurn.subagents);
    state = chatReducer(state, { type: "turn/started", threadId: "parent", turnId: "next-parent-turn" });
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
const childTurn: Extract<ServerNotification, { method: "turn/started" }>["params"]["turn"] = appServerTurnFixture({
  id: "child-turn",
  status: "inProgress",
  startedAt: 1,
  itemsView: "full",
  items: [],
});

function runningParent(): ChatState {
  return chatStateFixture({ activeThread: { id: "parent" }, activeTurn: { lifecycle: { kind: "running", turnId: "parent-turn" } } });
}

function trackedParent(): ChatState {
  return chatReducer(runningParent(), { type: "subagent-activity/tracked", threadId: "child", parentTurnId: "parent-turn" });
}

function localId(prefix: string): string {
  return prefix;
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
