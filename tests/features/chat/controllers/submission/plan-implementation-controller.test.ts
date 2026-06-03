import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore, type ChatStateStore } from "../../../../../src/features/chat/chat-state";
import { implementPlanCandidateFromState } from "../../../../../src/features/chat/plan-implementation";
import {
  PlanImplementationController,
  type PlanImplementationControllerHost,
} from "../../../../../src/features/chat/controllers/submission/plan-implementation-controller";
import { createSubmissionStatePort } from "../../../../../src/features/chat/controllers/state-ports";
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
    type: "thread/resumed",
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
  const host: PlanImplementationControllerHost = {
    state: createSubmissionStatePort(stateStore),
    currentClient: () => client,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    sendTurnText: vi.fn().mockResolvedValue(undefined),
  };
  return { controller: new PlanImplementationController(host), host, stateStore };
}

describe("PlanImplementationController", () => {
  it("finds the latest proposed plan only when the thread is implementable", () => {
    const stateStore = createChatStateStore(createChatState());
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    expect(implementPlanCandidateFromState(stateStore.getState())).toBe(latest);

    stateStore.dispatch({ type: "composer/draft-set", draft: "edit first" });

    expect(implementPlanCandidateFromState(stateStore.getState())).toBeNull();
  });

  it("switches out of plan mode and submits the implementation prompt", async () => {
    const { controller, host, stateStore } = createController();
    const plan = planItem("plan");
    resumeThread(stateStore, [plan]);
    stateStore.dispatch({ type: "ui/panel-set", panel: "model" });

    await controller.implement(plan);

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(stateStore.getState().selectedCollaborationMode).toBe("default");
    expect(stateStore.getState().runtimePicker).toBeNull();
    expect(host.sendTurnText).toHaveBeenCalledWith("Please implement this plan.");
  });

  it("ignores stale plan items", async () => {
    const { controller, host, stateStore } = createController();
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    await controller.implement(first);

    expect(host.ensureConnected).not.toHaveBeenCalled();
    expect(host.sendTurnText).not.toHaveBeenCalled();
  });
});
