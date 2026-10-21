import { describe, expect, it, vi } from "vitest";
import { createChatState } from "../../../../../src/features/chat/application/state/model";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { SubmissionInput } from "../../../../../src/features/chat/application/submission/input-claim";
import { implementPlan, type PlanImplementationHost } from "../../../../../src/features/chat/application/submission/plan-implementation";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred } from "../../../../support/async";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { emptyComposerInputSnapshot } from "../../support/composer-input";

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
  lifetime: { kind: "persistent" } | { kind: "ephemeral"; mode: "side-chat"; sourceThreadId: string; sourceThreadTitle: string | null } = {
    kind: "persistent" as const,
  },
  threadId = "thread",
): void {
  stateStore.dispatch({
    ...threadActivationFixture({ id: threadId, cliVersion: "test" } as never),
    type: "active-thread/resumed",
    items,
    lifetime,
  });
  stateStore.dispatch({
    type: "active-thread/settings-applied",
    ...stateStore.getState().runtime.active,
    collaborationMode: "plan",
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
    claimSubmission: (text) => new SubmissionInput(text, emptyComposerInputSnapshot(), stateStore.getState, () => {}),
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
  it.each(["", "edit first"])("implements the latest completed plan without consuming draft %j", async (draft) => {
    const { host, sendTurnText, stateStore } = createPlanImplementationHost();
    resumeThread(stateStore, [planItem("first"), planItem("latest")]);
    stateStore.dispatch({ type: "composer/draft-set", draft });

    await implementPlan(host, "latest");

    expect(sendTurnText).toHaveBeenCalledWith(expect.objectContaining({ text: "Please implement this plan." }));
    expect(stateStore.getState().composer.draft).toBe(draft);
  });

  it("does not implement a plan when the pending intent leaves Plan mode", async () => {
    const { host, ensureConnected, sendTurnText, stateStore } = createPlanImplementationHost();
    resumeThread(stateStore, [planItem("plan")]);
    stateStore.dispatch({
      type: "runtime/pending-intent-patched",
      patch: { collaborationMode: { kind: "set", value: "default" } },
    });

    await implementPlan(host, "plan");

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("does not implement a plan while its thread has a running turn", async () => {
    const { host, ensureConnected, sendTurnText, stateStore } = createPlanImplementationHost();
    resumeThread(stateStore, [planItem("plan")]);
    stateStore.dispatch({
      type: "runtime/pending-intent-patched",
      patch: { collaborationMode: { kind: "set", value: "plan" } },
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });

    await implementPlan(host, "plan");

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("ignores a newer streaming plan and implements the completed outcome", async () => {
    const { host, ensureConnected, sendTurnText, stateStore } = createPlanImplementationHost();
    resumeThread(stateStore, [planItem("completed"), streamingPlanItem("streaming")]);

    await implementPlan(host, "streaming");

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();

    await implementPlan(host, "completed");

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith(expect.objectContaining({ text: "Please implement this plan." }));
  });

  it.each(["persistent", "ephemeral"] as const)("implements the offered plan in a %s chat after leaving Plan mode", async (kind) => {
    const { host, ensureConnected, requestDefaultCollaborationModeForNextTurn, sendTurnText, stateStore } = createPlanImplementationHost();
    const plan = planItem("plan");
    resumeThread(
      stateStore,
      [plan],
      kind === "persistent" ? { kind } : { kind, mode: "side-chat" as const, sourceThreadId: "source", sourceThreadTitle: "Source" },
    );
    stateStore.dispatch({ type: "ui/panel-set", panel: "status-panel" });

    await implementPlan(host, plan.id);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(requestDefaultCollaborationModeForNextTurn).toHaveBeenCalledOnce();
    expect(stateStore.getState().runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("default"));
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(sendTurnText).toHaveBeenCalledWith(expect.objectContaining({ text: "Please implement this plan." }));
  });

  it.each(["source", "another fork"])("does not implement a shared plan after switching to %s while connecting", async (destination) => {
    const { host, ensureConnected, requestDefaultCollaborationModeForNextTurn, sendTurnText, stateStore } = createPlanImplementationHost();
    const plan = planItem("shared-plan");
    resumeThread(stateStore, [plan]);
    const preparation = {
      draft: { kind: "persistent" as const, sourceThreadId: "thread", boundary: { kind: "through-turn" as const, turnId: "turn" } },
      runtime: stateStore.getState().runtime,
      display: { items: [plan], turnDiffs: new Map() },
    };
    stateStore.dispatch({ type: "panel/fork-draft-applied", preparation });
    const connecting = deferred<boolean>();
    ensureConnected.mockReturnValue(connecting.promise);
    const implementing = implementPlan(host, plan.id);
    if (destination === "source") resumeThread(stateStore, [plan]);
    else stateStore.dispatch({ type: "panel/fork-draft-applied", preparation });
    connecting.resolve(true);
    await implementing;
    expect(requestDefaultCollaborationModeForNextTurn).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
    expect(stateStore.getState().runtime.active.collaborationMode).toBe("plan");
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
