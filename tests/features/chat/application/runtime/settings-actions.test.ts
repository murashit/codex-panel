import { describe, expect, it, vi } from "vitest";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import { emptyRuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import {
  type ChatRuntimeSettingsActions,
  createChatRuntimeSettingsActions,
} from "../../../../../src/features/chat/application/runtime/settings-actions";
import type { RuntimeSettingsTransport } from "../../../../../src/features/chat/application/runtime/settings-transport";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import type { ActiveThreadSettingsAppliedAction } from "../../../../../src/features/chat/application/state/actions";
import type { ChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { setCollaborationModeIntent, setRuntimeIntentValue } from "../../../../../src/features/chat/domain/runtime/intent";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("createChatRuntimeSettingsActions", () => {
  it("applies pending runtime intents through thread settings and commits them", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = createChatRuntimeSettingsActions({
      stateStore: store,
      runtimeTransport: transport,
      runtimeSnapshotForState: runtimeSnapshotFixture,
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(actions.requestModel("gpt-5.5")).resolves.toBe(true);

    expect(transport.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.model).toBe("gpt-5.5");
    expect(messages).toEqual([]);
  });

  it("commits pending permission profile updates into active permission state", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, {
      runtime: {
        active: {
          activePermissionProfile: { id: ":read-only", extends: null },
          sandboxPolicy: { type: "readOnly", networkAccess: false },
        },
        pending: {
          permissionProfile: setRuntimeIntentValue(":workspace"),
        },
      },
    });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.applyPendingThreadSettings()).resolves.toBe(true);

    expect(transport.updateThreadSettings).toHaveBeenCalledWith("thread", { permissions: ":workspace" });
    expect(store.getState().runtime.pending.permissionProfile).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.activePermissionProfile).toEqual({ id: ":workspace", extends: null });
    expect(store.getState().runtime.active.permissionProfileKnown).toBe(true);
    expect(store.getState().runtime.active.sandboxPolicy).toBeNull();
    expect(store.getState().runtime.active.sandboxPolicyKnown).toBe(true);
    expect(messages).toEqual([]);
  });

  it("reserves thread runtime settings when no thread is active", async () => {
    const store = createChatStateStore(chatStateFixture());
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.requestModel("gpt-5.5")).resolves.toBe(true);
    await expect(actions.requestReasoningEffort("high")).resolves.toBe(true);
    await actions.enableFastMode();
    await actions.enableAutoReview();
    await expect(actions.setCollaborationMode("plan")).resolves.toBe(true);
    actions.requestDefaultCollaborationModeForNextTurn();

    expect(transport.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(store.getState().runtime.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(store.getState().runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("default"));
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
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await actions.toggleFastMode();

    expect(transport.updateThreadSettings).toHaveBeenCalledWith("thread", { serviceTier: "fast" });
    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.serviceTier).toBe("fast");
    expect(store.getState().ui.toolbarPanel).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns."]);
  });

  it("enables and disables fast mode through explicit commands", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await actions.enableFastMode();
    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings("fast") });
    await actions.disableFastMode();

    expect(transport.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { serviceTier: "fast" });
    expect(transport.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { serviceTier: null });
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("keeps Fast disabled after clearing a thread tier when config defaults to Fast", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { connection: { runtimeConfig: { ...emptyRuntimeConfigSnapshot(), serviceTier: "fast" } } });
    state = chatStateWith(state, { runtime: { active: { serviceTier: "fast" } } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await actions.disableFastMode();

    expect(transport.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().runtime.active.serviceTier).toBeNull();
    expect(store.getState().runtime.active.serviceTierKnown).toBe(true);

    await actions.toggleFastMode();

    expect(transport.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "fast" });
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
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await actions.toggleFastMode();

    expect(transport.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "priority" });
    expect(store.getState().runtime.active.serviceTier).toBe("priority");

    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings("priority") });
    await actions.toggleFastMode();

    expect(transport.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().runtime.active.serviceTier).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("warns without reporting collaboration mode as applied when no effective model is available", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.setCollaborationMode("plan")).resolves.toBe(true);

    expect(transport.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("plan"));
    expect(store.getState().runtime.active.collaborationMode).toBeNull();
    expect(messages).toEqual(["Plan mode is selected, but No effective model is available. Sending without a mode override."]);
  });

  it("requests default collaboration mode for the next turn without applying thread settings", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { runtime: { active: { collaborationMode: "plan" } } });
    state = chatStateWith(state, { runtime: { pending: { collaborationMode: setCollaborationModeIntent("plan") } } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    actions.requestDefaultCollaborationModeForNextTurn();

    expect(transport.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("default"));
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
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = createChatRuntimeSettingsActions({
      stateStore: store,
      runtimeTransport: transport,
      runtimeSnapshotForState: (state) => ({ ...runtimeSnapshotFixture(state), runtimeConfig: null }),
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(actions.setCollaborationMode("plan")).resolves.toBe(true);

    expect(transport.updateThreadSettings).toHaveBeenCalledWith("thread", {
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
    const transport = settingsTransportFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.active.model).toBeNull();
    expect(messages).toEqual(["nope"]);
  });

  it("leaves pending runtime intent in place when the runtime transport is unavailable", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture({ updateThreadSettings: vi.fn().mockResolvedValue(false) });
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(transport.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.active.model).toBeNull();
    expect(messages).toEqual([]);
  });

  it("keeps the runtime panel open when a toolbar runtime update fails", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await actions.enableFastMode();

    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(store.getState().ui.toolbarPanel).toBe("status-panel");
    expect(messages).toEqual(["nope"]);
  });

  it("does not commit stale runtime updates after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        return true;
      }),
    });
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(transport.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().activeThread.id).toBeNull();
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("does not report stale runtime update failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        throw new Error("nope");
      }),
    });
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(store.getState().activeThread.id).toBeNull();
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("does not commit stale runtime updates after a newer pending intent replaces them", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const firstUpdate = deferred(true);
    const secondUpdate = deferred(true);
    const transport = settingsTransportFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => firstUpdate.promise)
        .mockImplementationOnce(() => secondUpdate.promise),
    });
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    const firstRequest = actions.requestModel("gpt-old");
    expect(transport.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-old" });

    const secondRequest = actions.requestModel("gpt-new");
    expect(transport.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "gpt-new" });

    secondUpdate.resolve();
    await expect(secondRequest).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });

    firstUpdate.resolve();
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
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await expect(actions.resetModelToConfig()).resolves.toBe(true);

    expect(transport.updateThreadSettings).toHaveBeenCalledWith("thread", { model: null });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.model).toBeNull();
  });

  it("enables and disables auto-review through explicit commands", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const transport = settingsTransportFixture();
    const messages: string[] = [];
    const actions = runtimeActionsFixture(store, transport, messages);

    await actions.enableAutoReview();
    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings(null, "auto_review") });
    await actions.disableAutoReview();

    expect(transport.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { approvalsReviewer: "auto_review" });
    expect(transport.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { approvalsReviewer: "user" });
    expect(messages).toEqual(["Auto-review on for subsequent turns.", "Auto-review off for subsequent turns."]);
  });
});

function runtimeActionsFixture(
  store: ReturnType<typeof createChatStateStore>,
  transport: RuntimeSettingsTransport,
  messages: string[],
): ChatRuntimeSettingsActions {
  return createChatRuntimeSettingsActions({
    stateStore: store,
    runtimeTransport: transport,
    runtimeSnapshotForState: runtimeSnapshotFixture,
    collaborationModeLabel: () => "Plan",
    addSystemMessage: (text) => messages.push(text),
  });
}

function settingsTransportFixture(overrides: Partial<RuntimeSettingsTransport> = {}): RuntimeSettingsTransport {
  return {
    updateThreadSettings: vi.fn().mockResolvedValue(true),
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
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
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
