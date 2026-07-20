import { describe, expect, it, vi } from "vitest";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  implementPlan,
  implementPlanTargetFromState,
  type PlanImplementationHost,
} from "../../../../../src/features/chat/application/turns/plan-implementation";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred } from "../../../../support/async";

const planItem = (id: string): ThreadStreamItem => ({
  id,
  kind: "dialogue",
  role: "assistant",
  text: "Plan",
  dialogueKind: "proposedPlan",
  dialogueState: "completed",
});

const streamingPlanItem = (id: string): ThreadStreamItem => ({
  id,
  kind: "dialogue",
  role: "assistant",
  text: "Plan",
  dialogueKind: "proposedPlan",
  dialogueState: "streaming",
});

function resumeThread(
  stateStore: ChatStateStore,
  items: readonly ThreadStreamItem[],
  lifetime: { kind: "persistent" } | { kind: "ephemeral"; sourceThreadId: string; sourceThreadTitle: string | null } = {
    kind: "persistent",
  },
  threadId = "thread",
): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: { id: threadId, cliVersion: "test" } as never,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    items,
    lifetime,
  });
  stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });
}

function createPlanImplementationHost() {
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

    stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
    expect(implementPlanTargetFromState(stateStore.getState())).toBeNull();

    stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    expect(implementPlanTargetFromState(stateStore.getState())).toBeNull();
  });

  it("ignores streaming proposed plans until they are implementable turn outcomes", () => {
    const stateStore = createChatStateStore(createChatState());
    const completed = planItem("completed");
    const streaming = streamingPlanItem("streaming");
    resumeThread(stateStore, [completed, streaming]);

    expect(implementPlanTargetFromState(stateStore.getState())).toEqual({ itemId: completed.id });
  });

  it("does not offer or send plan implementation from a side chat", async () => {
    const { host, ensureConnected, sendTurnText, stateStore } = createPlanImplementationHost();
    const plan = planItem("plan");
    resumeThread(stateStore, [plan], { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" });

    expect(implementPlanTargetFromState(stateStore.getState())).toBeNull();

    await implementPlan(host, plan.id);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("switches out of plan mode and submits the implementation prompt", async () => {
    const { host, ensureConnected, requestDefaultCollaborationModeForNextTurn, sendTurnText, stateStore } = createPlanImplementationHost();
    const plan = planItem("plan");
    resumeThread(stateStore, [plan]);
    stateStore.dispatch({ type: "ui/panel-set", panel: "status-panel" });

    await implementPlan(host, plan.id);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(requestDefaultCollaborationModeForNextTurn).toHaveBeenCalledOnce();
    expect(stateStore.getState().runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("default"));
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(sendTurnText).toHaveBeenCalledWith("Please implement this plan.");
  });

  it("ignores stale plan items", async () => {
    const { host, ensureConnected, sendTurnText, stateStore } = createPlanImplementationHost();
    const first = planItem("first");
    const latest = planItem("latest");
    resumeThread(stateStore, [first, latest]);

    await implementPlan(host, first.id);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("does not implement an old plan intent after leaving and returning to the same panel target", async () => {
    const { host, requestDefaultCollaborationModeForNextTurn, sendTurnText, stateStore } = createPlanImplementationHost();
    const connection = deferred<boolean>();
    host.ensureConnected = vi.fn(() => connection.promise);
    const plan = planItem("plan");
    resumeThread(stateStore, [plan]);

    const implementing = implementPlan(host, plan.id);
    await vi.waitFor(() => expect(host.ensureConnected).toHaveBeenCalledOnce());
    resumeThread(stateStore, [plan], { kind: "persistent" }, "other");
    resumeThread(stateStore, [plan]);
    connection.resolve(true);
    await implementing;

    expect(requestDefaultCollaborationModeForNextTurn).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });
});
