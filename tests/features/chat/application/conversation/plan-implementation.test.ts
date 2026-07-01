import { describe, expect, it, vi } from "vitest";

import {
  implementPlan,
  implementPlanTargetFromState,
  type PlanImplementationHost,
} from "../../../../../src/features/chat/application/conversation/plan-implementation";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";

const planItem = (id: string): MessageStreamItem => ({
  id,
  kind: "message",
  role: "assistant",
  text: "Plan",
  messageKind: "proposedPlan",
  messageState: "completed",
});

const streamingPlanItem = (id: string): MessageStreamItem => ({
  id,
  kind: "message",
  role: "assistant",
  text: "Plan",
  messageKind: "proposedPlan",
  messageState: "streaming",
});

function resumeThread(stateStore: ChatStateStore, items: readonly MessageStreamItem[]): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: { id: "thread", cliVersion: "test" } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    items,
  });
  stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });
}

function createController() {
  const stateStore = createChatStateStore(createChatState());
  const ensureConnected = vi.fn().mockResolvedValue(true);
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const requestDefaultCollaborationModeForNextTurn = vi.fn(() => {
    stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
  });
  const host: PlanImplementationHost = {
    stateStore,
    ensureConnected,
    sendTurnText,
    requestDefaultCollaborationModeForNextTurn,
  };
  return {
    ensureConnected,
    host,
    requestDefaultCollaborationModeForNextTurn,
    sendTurnText,
    stateStore,
  };
}

describe("implementPlan", () => {
  it("finds the latest proposed plan only when the thread is idle and in plan mode", () => {
    const stateStore = createChatStateStore(createChatState());
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    expect(implementPlanTargetFromState(stateStore.getState())).toEqual({ itemId: latest.id });

    stateStore.dispatch({ type: "composer/draft-set", draft: "edit first" });

    expect(implementPlanTargetFromState(stateStore.getState())).toEqual({ itemId: latest.id });
  });

  it("ignores streaming proposed plans until they are implementable turn outcomes", () => {
    const stateStore = createChatStateStore(createChatState());
    const completed = planItem("completed");
    const streaming = streamingPlanItem("streaming");
    resumeThread(stateStore, [completed, streaming]);

    expect(implementPlanTargetFromState(stateStore.getState())).toEqual({ itemId: completed.id });
  });

  it("switches out of plan mode and submits the implementation prompt", async () => {
    const { host, ensureConnected, requestDefaultCollaborationModeForNextTurn, sendTurnText, stateStore } = createController();
    const plan = planItem("plan");
    resumeThread(stateStore, [plan]);
    stateStore.dispatch({ type: "ui/panel-set", panel: "status-panel" });

    await implementPlan(host, plan.id);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(requestDefaultCollaborationModeForNextTurn).toHaveBeenCalledOnce();
    expect(stateStore.getState().runtime.pending.collaborationMode).toEqual({ kind: "set", value: "default" });
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(sendTurnText).toHaveBeenCalledWith("Please implement this plan.");
  });

  it("ignores stale plan items", async () => {
    const { host, ensureConnected, sendTurnText, stateStore } = createController();
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    await implementPlan(host, first.id);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });
});
