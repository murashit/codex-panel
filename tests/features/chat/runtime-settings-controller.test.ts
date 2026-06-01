import { describe, expect, it, vi } from "vitest";

import { ChatRuntimeSettingsController } from "../../../src/features/chat/runtime-settings-controller";
import { createChatState, createChatStateStore, type ChatAction } from "../../../src/features/chat/chat-state";
import type { AppServerClient } from "../../../src/app-server/client";
import type { Model } from "../../../src/generated/app-server/v2/Model";

describe("ChatRuntimeSettingsController", () => {
  it("applies pending runtime overrides through thread settings and commits them", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = new ChatRuntimeSettingsController({
      stateStore: store,
      currentClient: () => client as AppServerClient,
      runtimeSnapshot: () => ({
        effectiveConfig: store.getState().effectiveConfig,
        activeThreadId: store.getState().activeThreadId,
        activeModel: store.getState().activeModel,
        activeReasoningEffort: store.getState().activeReasoningEffort,
        activeCollaborationMode: store.getState().activeCollaborationMode,
        activeServiceTier: store.getState().activeServiceTier,
        activeApprovalPolicy: store.getState().activeApprovalPolicy,
        activeApprovalsReviewer: store.getState().activeApprovalsReviewer,
        activePermissionProfile: store.getState().activePermissionProfile,
        requestedModel: store.getState().requestedModel,
        requestedReasoningEffort: store.getState().requestedReasoningEffort,
        requestedApprovalsReviewer: store.getState().requestedApprovalsReviewer,
        selectedCollaborationMode: store.getState().selectedCollaborationMode,
        requestedServiceTier: store.getState().requestedServiceTier,
        tokenUsage: store.getState().tokenUsage,
        rateLimit: store.getState().rateLimit,
        hasThreadTurns: false,
        availableModels: store.getState().availableModels,
      }),
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(controller.setRequestedModel("gpt-5.5")).resolves.toBe(true);

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().requestedModel).toEqual({ kind: "unchanged" });
    expect(store.getState().activeModel).toBe("gpt-5.5");
    expect(messages).toEqual([]);
  });

  it("toggles fast mode and reports the user-visible result", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { serviceTier: "fast" });
    expect(store.getState().requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(store.getState().activeServiceTier).toBe("fast");
    expect(messages).toEqual(["Fast mode on for subsequent turns."]);
  });

  it("requests the catalog Fast tier id and toggles it off from the reported effective id", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.activeModel = "gpt-5.5";
    // Codex app-server 0.134.0 advertises Fast as id "priority" and reports that id as the effective service tier.
    state.availableModels = [modelFixture("gpt-5.5", "priority")];
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "priority" });
    expect(store.getState().activeServiceTier).toBe("priority");

    store.dispatch({ type: "thread/settings-applied", ...threadSettings("priority") });
    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().activeServiceTier).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("leaves pending override in place when the app-server update fails", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    const store = createChatStateStore(state);
    const client = clientFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.setRequestedModel("gpt-5.5")).resolves.toBe(false);

    expect(store.getState().requestedModel).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().activeModel).toBeNull();
    expect(messages).toEqual(["nope"]);
  });
});

function runtimeControllerFixture(
  store: ReturnType<typeof createChatStateStore>,
  client: Pick<AppServerClient, "updateThreadSettings">,
  messages: string[],
): ChatRuntimeSettingsController {
  return new ChatRuntimeSettingsController({
    stateStore: store,
    currentClient: () => client as AppServerClient,
    runtimeSnapshot: () => {
      const state = store.getState();
      return {
        effectiveConfig: state.effectiveConfig,
        activeThreadId: state.activeThreadId,
        activeModel: state.activeModel,
        activeReasoningEffort: state.activeReasoningEffort,
        activeCollaborationMode: state.activeCollaborationMode,
        activeServiceTier: state.activeServiceTier,
        activeApprovalPolicy: state.activeApprovalPolicy,
        activeApprovalsReviewer: state.activeApprovalsReviewer,
        activePermissionProfile: state.activePermissionProfile,
        requestedModel: state.requestedModel,
        requestedReasoningEffort: state.requestedReasoningEffort,
        requestedApprovalsReviewer: state.requestedApprovalsReviewer,
        selectedCollaborationMode: state.selectedCollaborationMode,
        requestedServiceTier: state.requestedServiceTier,
        tokenUsage: state.tokenUsage,
        rateLimit: state.rateLimit,
        hasThreadTurns: false,
        availableModels: state.availableModels,
      };
    },
    collaborationModeLabel: () => "Plan",
    addSystemMessage: (text) => messages.push(text),
  });
}

function clientFixture(
  overrides: Partial<Pick<AppServerClient, "updateThreadSettings">> = {},
): Pick<AppServerClient, "updateThreadSettings"> {
  return {
    updateThreadSettings: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function modelFixture(model: string, fastTierId: string): Model {
  return {
    id: model,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    supportsPersonality: true,
    additionalSpeedTiers: ["fast"],
    serviceTiers: [{ id: fastTierId, name: "Fast", description: "" }],
    defaultServiceTier: null,
    isDefault: true,
  };
}

function threadSettings(serviceTier: string | null): Omit<Extract<ChatAction, { type: "thread/settings-applied" }>, "type"> {
  return {
    cwd: "/vault",
    model: "gpt-5.5",
    reasoningEffort: "high",
    collaborationMode: "default",
    serviceTier,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    activePermissionProfile: null,
  };
}
