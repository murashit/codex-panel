import { describe, expect, it, vi } from "vitest";
import { activePanelOperationDecision } from "../../../../../src/features/chat/application/panel-operation-policy";
import { activeThreadState, createChatState } from "../../../../../src/features/chat/application/state/model";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { chatThreadStreamViewState } from "../../../../../src/features/chat/application/state/turn-scope";
import {
  implementPlan,
  implementPlanTarget,
  type PlanImplementationHost,
} from "../../../../../src/features/chat/application/submission/plan-implementation";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

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
  stateStore.dispatch({
    type: "runtime/pending-intent-patched",
    patch: { collaborationMode: { kind: "set", value: "plan" } },
  });
}

function createPlanImplementationHost() {
  const stateStore = createChatStateStore(createChatState());
  const ensureConnected = vi.fn().mockResolvedValue(true);
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const requestDefaultCollaborationModeForNextTurn = vi.fn(() => {
    stateStore.dispatch({
      type: "runtime/pending-intent-patched",
      patch: { collaborationMode: { kind: "set", value: "default" } },
    });
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

function implementPlanTargetFromState(state: ReturnType<ChatStateStore["getState"]>) {
  return implementPlanTarget({
    activeThread: activeThreadState(state),
    modeAllowed: activePanelOperationDecision(state, "implement-plan").kind === "allowed",
    activeTurn: state.activeTurn,
    runtime: state.runtime,
    threadStream: chatThreadStreamViewState(state.threadStream, state.activeTurn),
  });
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

    stateStore.dispatch({
      type: "runtime/pending-intent-patched",
      patch: { collaborationMode: { kind: "set", value: "default" } },
    });
    expect(implementPlanTargetFromState(stateStore.getState())).toBeNull();

    stateStore.dispatch({
      type: "runtime/pending-intent-patched",
      patch: { collaborationMode: { kind: "set", value: "plan" } },
    });
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
});
