import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore, type ChatStateStore } from "../../../../../src/features/chat/state/reducer";
import { implementPlanCandidateFromState } from "../../../../../src/features/chat/display/action-candidates";
import {
  createPlanImplementationActions,
  type PlanImplementationActionsHost,
} from "../../../../../src/features/chat/conversation/turns/plan-implementation-actions";
import type { DisplayItem } from "../../../../../src/features/chat/display/types";

const planItem = (id: string): DisplayItem => ({
  id,
  kind: "message",
  role: "assistant",
  text: "Plan",
  messageKind: "proposedPlan",
  messageState: "completed",
});

function resumeThread(stateStore: ChatStateStore, displayItems: readonly DisplayItem[]): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    thread: { id: "thread", cliVersion: "test" } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalPolicy: null,
    approvalsReviewer: null,
    activePermissionProfile: null,
    displayItems,
  });
  stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });
}

function createController({ client = {} as AppServerClient } = {}) {
  const stateStore = createChatStateStore(createChatState());
  const ensureConnected = vi.fn().mockResolvedValue(undefined);
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const host: PlanImplementationActionsHost = {
    stateStore,
    connection: {
      currentClient: () => client,
      ensureConnected,
    },
    submission: {
      sendTurnText,
    },
  };
  return { controller: createPlanImplementationActions(host), ensureConnected, sendTurnText, stateStore };
}

describe("createPlanImplementationActions", () => {
  it("finds the latest proposed plan only when the thread is idle and in plan mode", () => {
    const stateStore = createChatStateStore(createChatState());
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    expect(implementPlanCandidateFromState(stateStore.getState())).toBe(latest);

    stateStore.dispatch({ type: "composer/draft-set", draft: "edit first" });

    expect(implementPlanCandidateFromState(stateStore.getState())).toBe(latest);
  });

  it("switches out of plan mode and submits the implementation prompt", async () => {
    const { controller, ensureConnected, sendTurnText, stateStore } = createController();
    const plan = planItem("plan");
    resumeThread(stateStore, [plan]);
    stateStore.dispatch({ type: "ui/panel-set", panel: "status-panel" });

    await controller.implement(plan);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(stateStore.getState().runtime.selectedCollaborationMode).toBe("default");
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(sendTurnText).toHaveBeenCalledWith("Please implement this plan.");
  });

  it("ignores stale plan items", async () => {
    const { controller, ensureConnected, sendTurnText, stateStore } = createController();
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    await controller.implement(first);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });
});
