import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { ModelMetadata } from "../../../../src/domain/catalog/metadata";
import { emptyRuntimeConfigSnapshot } from "../../../../src/domain/runtime/config";
import {
  type ChatRuntimeSettingsActions,
  createChatRuntimeSettingsActions,
} from "../../../../src/features/chat/application/runtime/settings-actions";
import { runtimeSnapshotForChatState } from "../../../../src/features/chat/application/runtime/snapshot";
import type { ActiveThreadSettingsAppliedAction } from "../../../../src/features/chat/application/state/actions";
import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { chatStateFixture, chatStateWith } from "../support/state";

describe("createChatRuntimeSettingsActions", () => {
  it("applies pending runtime intents through thread settings and commits them", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = createChatRuntimeSettingsActions({
      stateStore: store,
      currentClient: () => client as AppServerClient,
      runtimeSnapshotForState: runtimeSnapshotFixture,
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(controller.requestModel("gpt-5.5")).resolves.toBe(true);

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.model).toBe("gpt-5.5");
    expect(messages).toEqual([]);
  });

  it("reserves thread runtime settings when no thread is active", async () => {
    const store = createChatStateStore(chatStateFixture());
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.requestModel("gpt-5.5")).resolves.toBe(true);
    await expect(controller.requestReasoningEffort("high")).resolves.toBe(true);
    await controller.enableFastMode();
    await controller.enableAutoReview();
    await expect(controller.setCollaborationMode("plan")).resolves.toBe(true);
    controller.requestDefaultCollaborationModeForNextTurn();

    expect(client.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(store.getState().runtime.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(store.getState().runtime.pending.collaborationMode).toBe("default");
    expect(messages).toEqual([
      "Fast mode on for subsequent turns.",
      "Auto-review on for subsequent turns.",
      "Plan mode on for subsequent turns.",
    ]);
  });

  it("toggles fast mode and reports the user-visible result", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { serviceTier: "fast" });
    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.serviceTier).toBe("fast");
    expect(store.getState().ui.toolbarPanel).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns."]);
  });

  it("enables and disables fast mode through explicit commands", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.enableFastMode();
    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings("fast") });
    await controller.disableFastMode();

    expect(client.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { serviceTier: "fast" });
    expect(client.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { serviceTier: null });
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("keeps Fast disabled after clearing a thread tier when config defaults to Fast", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { connection: { runtimeConfig: { ...emptyRuntimeConfigSnapshot(), serviceTier: "fast" } } });
    state = chatStateWith(state, { runtime: { active: { serviceTier: "fast" } } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.disableFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().runtime.active.serviceTier).toBeNull();
    expect(store.getState().runtime.active.serviceTierKnown).toBe(true);

    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "fast" });
    expect(messages).toEqual(["Fast mode off for subsequent turns.", "Fast mode on for subsequent turns."]);
  });

  it("requests the catalog Fast tier id and toggles it off from the reported effective id", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { runtime: { active: { model: "gpt-5.5" } } });
    // app-server may advertise Fast with an id such as "priority";
    // last verified against codex app-server 0.142.0.
    state = chatStateWith(state, { connection: { availableModels: [modelFixture("gpt-5.5", "priority")] } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "priority" });
    expect(store.getState().runtime.active.serviceTier).toBe("priority");

    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings("priority") });
    await controller.toggleFastMode();

    expect(client.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().runtime.active.serviceTier).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("warns without reporting collaboration mode as applied when no effective model is available", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.setCollaborationMode("plan")).resolves.toBe(true);

    expect(client.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.collaborationMode).toBe("plan");
    expect(store.getState().runtime.active.collaborationMode).toBeNull();
    expect(messages).toEqual(["Plan mode is selected, but No effective model is available. Sending without a mode override."]);
  });

  it("requests default collaboration mode for the next turn without applying thread settings", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { runtime: { active: { collaborationMode: "plan" } } });
    state = chatStateWith(state, { runtime: { pending: { collaborationMode: "plan" } } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    controller.requestDefaultCollaborationModeForNextTurn();

    expect(client.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.collaborationMode).toBe("default");
    expect(store.getState().runtime.active.collaborationMode).toBe("plan");
    expect(messages).toEqual([]);
  });

  it("builds pending thread settings from explicit effective config", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, {
      connection: {
        runtimeConfig: {
          ...emptyRuntimeConfigSnapshot(),
          model: "gpt-config",
          reasoningEffort: "medium",
        },
      },
    });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = createChatRuntimeSettingsActions({
      stateStore: store,
      currentClient: () => client as AppServerClient,
      runtimeSnapshotForState: (state) => ({ ...runtimeSnapshotFixture(state), runtimeConfig: null }),
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(controller.setCollaborationMode("plan")).resolves.toBe(true);

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", {
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-config",
          reasoningEffort: "medium",
          developerInstructions: null,
        },
      },
    });
    expect(messages).toEqual(["Plan mode on for subsequent turns."]);
  });

  it("leaves pending runtime intent in place when the app-server update fails", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const client = clientFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.active.model).toBeNull();
    expect(messages).toEqual(["nope"]);
  });

  it("keeps the runtime panel open when a toolbar runtime update fails", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });
    const store = createChatStateStore(state);
    const client = clientFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.enableFastMode();

    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(store.getState().ui.toolbarPanel).toBe("status-panel");
    expect(messages).toEqual(["nope"]);
  });

  it("does not commit stale runtime updates after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const client = clientFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        return {};
      }),
    });
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().activeThread.id).toBeNull();
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("does not report stale runtime update failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const client = clientFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        throw new Error("nope");
      }),
    });
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(store.getState().activeThread.id).toBeNull();
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("does not commit stale runtime updates after a newer pending intent replaces them", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const firstUpdate = deferred({});
    const secondUpdate = deferred({});
    const client = clientFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => firstUpdate.promise)
        .mockImplementationOnce(() => secondUpdate.promise),
    });
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    const firstRequest = controller.requestModel("gpt-old");
    expect(client.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-old" });

    const secondRequest = controller.requestModel("gpt-new");
    expect(client.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "gpt-new" });

    secondUpdate.resolve({});
    await expect(secondRequest).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });

    firstUpdate.resolve({});
    await expect(firstRequest).resolves.toBe(false);
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("resets requested model to config through an explicit command", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { runtime: { active: { model: "gpt-5.5" } } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await expect(controller.resetModelToConfig()).resolves.toBe(true);

    expect(client.updateThreadSettings).toHaveBeenCalledWith("thread", { model: null });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.model).toBeNull();
  });

  it("enables and disables auto-review through explicit commands", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const client = clientFixture();
    const messages: string[] = [];
    const controller = runtimeControllerFixture(store, client, messages);

    await controller.enableAutoReview();
    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings(null, "auto_review") });
    await controller.disableAutoReview();

    expect(client.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { approvalsReviewer: "auto_review" });
    expect(client.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { approvalsReviewer: "user" });
    expect(messages).toEqual(["Auto-review on for subsequent turns.", "Auto-review off for subsequent turns."]);
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
    runtimeSnapshotForState: runtimeSnapshotFixture,
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
  return runtimeSnapshotForChatState(state);
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

function threadSettings(
  serviceTier: string | null,
  approvalsReviewer: Omit<ActiveThreadSettingsAppliedAction, "type">["approvalsReviewer"] = "user",
): Omit<ActiveThreadSettingsAppliedAction, "type"> {
  return {
    cwd: "/vault",
    model: "gpt-5.5",
    reasoningEffort: "high",
    collaborationMode: "default",
    serviceTier,
    approvalsReviewer,
  };
}

function deferred<T>(initialValue: T): { promise: Promise<T>; resolve: (value?: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return {
    promise,
    resolve: (value = initialValue) => {
      resolve(value);
    },
  };
}
