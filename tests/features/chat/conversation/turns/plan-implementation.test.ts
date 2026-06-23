import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore, type ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  implementPlan,
  implementPlanTargetFromState,
  type PlanImplementationHost,
} from "../../../../../src/features/chat/application/conversation/plan-implementation";
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

function createController({ client = {} as AppServerClient } = {}) {
  const stateStore = createChatStateStore(createChatState());
  const connectedClient = vi.fn().mockResolvedValue(client);
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const requestDefaultCollaborationModeForNextTurn = vi.fn(() => {
    stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
  });
  const host: PlanImplementationHost = {
    stateStore,
    connectedClient,
    sendTurnText,
    requestDefaultCollaborationModeForNextTurn,
  };
  return {
    connectedClient,
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
    const { host, connectedClient, requestDefaultCollaborationModeForNextTurn, sendTurnText, stateStore } = createController();
    const plan = planItem("plan");
    resumeThread(stateStore, [plan]);
    stateStore.dispatch({ type: "ui/panel-set", panel: "status-panel" });

    await implementPlan(host, plan.id);

    expect(connectedClient).toHaveBeenCalledOnce();
    expect(requestDefaultCollaborationModeForNextTurn).toHaveBeenCalledOnce();
    expect(stateStore.getState().runtime.pending.collaborationMode).toBe("default");
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(sendTurnText).toHaveBeenCalledWith("Please implement this plan.");
  });

  it("ignores stale plan items", async () => {
    const { host, connectedClient, sendTurnText, stateStore } = createController();
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    await implementPlan(host, first.id);

    expect(connectedClient).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });
});
