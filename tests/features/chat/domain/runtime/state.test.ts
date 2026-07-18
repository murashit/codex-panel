import { describe, expect, it } from "vitest";
import { setRuntimeIntentValue } from "../../../../../src/features/chat/domain/runtime/intent";
import {
  clearRequestedApprovalsReviewerRuntimeState,
  clearRequestedFastModeRuntimeState,
  commitAppliedRuntimeSettingsPatchState,
  initialChatRuntimeState,
  requestApprovalsReviewerRuntimeState,
  requestFastModeRuntimeState,
  requestModelRuntimeState,
  requestReasoningEffortRuntimeState,
  resetModelToConfigRuntimeState,
  resetReasoningEffortToConfigRuntimeState,
} from "../../../../../src/features/chat/domain/runtime/state";

describe("chat runtime state", () => {
  it("commits applied settings and clears only their pending intents", () => {
    let state = initialChatRuntimeState();
    state = requestModelRuntimeState(state, "gpt-5.1");
    state = requestReasoningEffortRuntimeState(state, "high");
    state = requestFastModeRuntimeState(state, "enabled");
    state = requestApprovalsReviewerRuntimeState(state, "auto_review");

    const next = commitAppliedRuntimeSettingsPatchState(state, {
      model: "gpt-5.1",
      effort: "high",
      serviceTier: "fast",
      approvalsReviewer: "auto_review",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.1",
          reasoningEffort: "high",
          developerInstructions: null,
        },
      },
    });

    expect(next.active).toMatchObject({
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: "fast",
      serviceTierKnown: true,
      approvalsReviewer: "auto_review",
      collaborationMode: "plan",
    });
    expect(next.pending).toMatchObject({
      model: { kind: "unchanged" },
      reasoningEffort: { kind: "unchanged" },
      fastMode: { kind: "unchanged" },
      approvalsReviewer: { kind: "unchanged" },
      collaborationMode: { kind: "unchanged" },
    });
  });

  it.each([
    { applied: "never" as const, expectedPolicy: "never" as const, expectedKnown: true },
    { applied: null, expectedPolicy: null, expectedKnown: false },
  ])("applies approval policy $applied with the correct known state", ({ applied, expectedPolicy, expectedKnown }) => {
    const state = {
      ...initialChatRuntimeState(),
      active: {
        ...initialChatRuntimeState().active,
        approvalPolicy: "on-request" as const,
        approvalPolicyKnown: true,
      },
    };

    const next = commitAppliedRuntimeSettingsPatchState(state, { approvalPolicy: applied });

    expect(next.active.approvalPolicy).toBe(expectedPolicy);
    expect(next.active.approvalPolicyKnown).toBe(expectedKnown);
  });

  it("clears only the applied approval policy intent and preserves unrelated state", () => {
    const initial = initialChatRuntimeState();
    const state = {
      ...initial,
      active: {
        ...initial.active,
        model: "gpt-5.1",
        reasoningEffort: "high" as const,
        serviceTier: "flex" as const,
        serviceTierKnown: true,
        approvalsReviewer: "user" as const,
      },
      pending: {
        ...initial.pending,
        model: setRuntimeIntentValue("gpt-5.1"),
        reasoningEffort: setRuntimeIntentValue("high" as const),
        permissionProfile: setRuntimeIntentValue(":workspace"),
        approvalPolicy: setRuntimeIntentValue("never" as const),
        approvalsReviewer: setRuntimeIntentValue("auto_review" as const),
        fastMode: setRuntimeIntentValue("enabled" as const),
      },
    };

    const next = commitAppliedRuntimeSettingsPatchState(state, { approvalPolicy: "never" });

    expect(next.active).toMatchObject({
      ...state.active,
      approvalPolicy: "never",
      approvalPolicyKnown: true,
    });
    expect(next.pending).toMatchObject({
      ...state.pending,
      approvalPolicy: { kind: "unchanged" },
    });
  });

  it("preserves unknown service tier state when committing unrelated settings", () => {
    const state = requestModelRuntimeState(initialChatRuntimeState(), "gpt-5.1");
    const next = commitAppliedRuntimeSettingsPatchState(state, { model: "gpt-5.1" });

    expect(next.active.model).toBe("gpt-5.1");
    expect(next.active.serviceTier).toBeNull();
    expect(next.active.serviceTierKnown).toBe(false);
  });

  it("keeps requested policy toggles pending until settings commit", () => {
    const initial = initialChatRuntimeState();
    const active = {
      ...initial,
      active: { ...initial.active, serviceTier: "flex" as const, approvalsReviewer: "user" as const },
    };
    const requested = requestApprovalsReviewerRuntimeState(requestFastModeRuntimeState(active, "enabled"), "auto_review");

    expect(requested.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(requested.active.serviceTier).toBe("flex");
    expect(requested.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(requested.active.approvalsReviewer).toBe("user");
  });

  it("keeps reset and cleared request semantics explicit", () => {
    let state = requestModelRuntimeState(initialChatRuntimeState(), "gpt-5.1");
    state = requestReasoningEffortRuntimeState(state, "high");
    state = requestFastModeRuntimeState(state, "enabled");
    state = requestApprovalsReviewerRuntimeState(state, "auto_review");
    state = resetModelToConfigRuntimeState(state);
    state = resetReasoningEffortToConfigRuntimeState(state);
    state = clearRequestedFastModeRuntimeState(state);
    state = clearRequestedApprovalsReviewerRuntimeState(state);

    expect(state.pending).toMatchObject({
      model: { kind: "resetToConfig" },
      reasoningEffort: { kind: "resetToConfig" },
      fastMode: { kind: "unchanged" },
      approvalsReviewer: { kind: "unchanged" },
    });
  });
});
