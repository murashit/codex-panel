import { describe, expect, it, vi } from "vitest";

import {
  createChatRuntimeSettingsActions,
  type ChatRuntimeSettingsActions,
} from "../../../../src/features/chat/runtime/runtime-settings-actions";
import { createChatState, createChatStateStore, type ChatState } from "../../../../src/features/chat/state/reducer";
import { runtimeSnapshotForChatSlices } from "../../../../src/features/chat/panel/view-model";
import type { ActiveThreadSettingsAppliedAction } from "../../../../src/features/chat/state/actions";
import type { AppServerClient } from "../../../../src/app-server/client";
import type { ModelMetadata } from "../../../../src/domain/catalog/metadata";

describe("createChatRuntimeSettingsActions", () => {
  it("applies pending runtime overrides through thread settings and commits them", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = createChatRuntimeSettingsActions({
      stateStore: store,
      currentClient: () => client as AppServerClient,
      runtimeSnapshot: () => runtimeSnapshotFixture(store.getState()),
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(controller.setRequestedModel("gpt-5.5")).resolves.toBe(true);

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().runtime.requestedModel).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.activeModel).toBe("gpt-5.5");
    expect(messages).toEqual([]);
  });

  it("toggles fast mode and reports the user-visible result", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { serviceTier: "fast" });
    expect(store.getState().runtime.requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.activeServiceTier).toBe("fast");
    expect(messages).toEqual(["Fast mode on for subsequent turns."]);
  });

  it("requests the catalog Fast tier id and toggles it off from the reported effective id", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.runtime.activeModel = "gpt-5.5";
    // Codex app-server 0.134.0 advertises Fast as id "priority" and reports that id as the effective service tier.
    state.connection.availableModels = [modelFixture("gpt-5.5", "priority")];
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "priority" });
    expect(store.getState().runtime.activeServiceTier).toBe("priority");

    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings("priority") });
    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().runtime.activeServiceTier).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("warns without reporting collaboration mode as applied when no effective model is available", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.setCollaborationMode("plan")).resolves.toBe(true);

    expect(client.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.selectedCollaborationMode).toBe("plan");
    expect(store.getState().runtime.activeCollaborationMode).toBe("default");
    expect(messages).toEqual(["Plan mode is selected, but No effective model is available. Sending without a mode override."]);
  });

  it("leaves pending override in place when the app-server update fails", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    const store = createChatStateStore(state);
    const client = clientFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.setRequestedModel("gpt-5.5")).resolves.toBe(false);

    expect(store.getState().runtime.requestedModel).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.activeModel).toBeNull();
    expect(messages).toEqual(["nope"]);
  });
});

function runtimeControllerFixture(
  store: ReturnType<typeof createChatStateStore>,
  client: Pick<AppServerClient, "updateThreadSettings">,
  messages: string[],
): ChatRuntimeSettingsActions {
  return createChatRuntimeSettingsActions({
    stateStore: store,
    currentClient: () => client as AppServerClient,
    runtimeSnapshot: () => runtimeSnapshotFixture(store.getState()),
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

function runtimeSnapshotFixture(state: ChatState) {
  return runtimeSnapshotForChatSlices({
    runtimeConfig: state.connection.runtimeConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    displayItems: state.transcript.displayItems,
    availableModels: state.connection.availableModels,
  });
}

function modelFixture(model: string, fastTierId: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    additionalSpeedTiers: ["fast"],
    serviceTiers: [{ id: fastTierId, name: "Fast" }],
    defaultServiceTier: null,
    isDefault: true,
  };
}

function threadSettings(serviceTier: string | null): Omit<ActiveThreadSettingsAppliedAction, "type"> {
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
