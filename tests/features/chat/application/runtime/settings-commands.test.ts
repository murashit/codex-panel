import { describe, expect, it, vi } from "vitest";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import {
  type ChatRuntimeSettingsCommands,
  createChatRuntimeSettingsCommands,
} from "../../../../../src/features/chat/application/runtime/settings-commands";
import type { RuntimeSettingsPort } from "../../../../../src/features/chat/application/runtime/settings-port";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import type { ActiveThreadSettingsAppliedAction } from "../../../../../src/features/chat/application/state/actions";
import { activeThreadId, type ChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { setCollaborationModeIntent, setRuntimeIntentValue } from "../../../../../src/features/chat/domain/runtime/intent";
import { createKeyedOperationQueue, type KeyedOperationQueue } from "../../../../../src/shared/runtime/keyed-operation-queue";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("createChatRuntimeSettingsCommands", () => {
  it("applies pending runtime intents through thread settings and commits them", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = createChatRuntimeSettingsCommands({
      stateStore: store,
      runtimeSettingsPort: port,
      runtimeSnapshotForState: runtimeSnapshotFixture,
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
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
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.applyPendingThreadSettings()).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { permissions: ":workspace" });
    expect(store.getState().runtime.pending.permissionProfile).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.activePermissionProfile).toEqual({ id: ":workspace", extends: null });
    expect(store.getState().runtime.active.permissionProfileKnown).toBe(true);
    expect(store.getState().runtime.active.sandboxPolicy).toBeNull();
    expect(store.getState().runtime.active.sandboxPolicyKnown).toBe(true);
    expect(messages).toEqual([]);
  });

  it("requests and resets permission profiles through thread settings", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, {
      runtime: {
        active: {
          activePermissionProfile: { id: ":read-only", extends: null },
          sandboxPolicy: { type: "readOnly", networkAccess: false },
        },
      },
    });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestPermissionProfile(":workspace")).resolves.toBe(true);
    await expect(commands.resetPermissionProfileToConfig()).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { permissions: ":workspace" });
    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { permissions: null });
    expect(store.getState().runtime.pending.permissionProfile).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.activePermissionProfile).toBeNull();
    expect(store.getState().runtime.active.permissionProfileKnown).toBe(false);
    expect(messages).toEqual([]);
  });

  it("blocks permission profile changes for ephemeral side chats", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "side",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestPermissionProfile(":workspace")).resolves.toBe(false);
    await expect(commands.resetPermissionProfileToConfig()).resolves.toBe(false);

    expect(port.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.permissionProfile).toEqual({ kind: "unchanged" });
    expect(messages).toEqual(["Permission changes are unavailable in side chats.", "Permission changes are unavailable in side chats."]);
  });

  it("keeps an empty settings commit harmless in a side chat while blocking a real settings mutation", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "side",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.applyPendingThreadSettings()).resolves.toBe(true);
    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(port.updateThreadSettings).not.toHaveBeenCalled();
    expect(messages).toEqual(["Thread settings are unavailable in side chats."]);
  });

  it("blocks all thread setting changes for subagent threads", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "child",
        provenance: {
          kind: "subagent",
          subagentKind: "thread-spawn",
          parentThreadId: "parent",
          sessionId: "session",
          depth: 1,
          agentNickname: null,
          agentRole: null,
        },
      },
    });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);
    await expect(commands.requestReasoningEffort("high")).resolves.toBe(false);
    await expect(commands.requestPermissionProfile(":workspace")).resolves.toBe(false);
    await expect(commands.setCollaborationMode("plan")).resolves.toBe(false);
    await commands.enableFastMode();
    await commands.enableAutoReview();

    expect(port.updateThreadSettings).not.toHaveBeenCalled();
    expect(messages).toHaveLength(6);
    expect(new Set(messages)).toEqual(new Set(["Thread settings are unavailable in agent threads."]));
  });

  it("reserves thread runtime settings when no thread is active", async () => {
    const store = createChatStateStore(chatStateFixture());
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(true);
    await expect(commands.requestPermissionProfile(":workspace")).resolves.toBe(true);
    await expect(commands.requestReasoningEffort("high")).resolves.toBe(true);
    await commands.enableFastMode();
    await commands.enableAutoReview();
    await expect(commands.setCollaborationMode("plan")).resolves.toBe(true);
    commands.requestDefaultCollaborationModeForNextTurn();

    expect(port.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.pending.permissionProfile).toEqual({ kind: "set", value: ":workspace" });
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
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await commands.toggleFastMode();

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { serviceTier: "fast" });
    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.serviceTier).toBe("fast");
    expect(store.getState().ui.toolbarPanel).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns."]);
  });

  it("enables and disables fast mode through explicit commands", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await commands.enableFastMode();
    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings("fast") });
    await commands.disableFastMode();

    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { serviceTier: "fast" });
    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { serviceTier: null });
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("keeps Fast disabled after clearing a thread tier when config defaults to Fast", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { connection: { runtimeConfig: { ...runtimeConfigFixture(), serviceTier: "fast" } } });
    state = chatStateWith(state, { runtime: { active: { serviceTier: "fast" } } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await commands.disableFastMode();

    expect(port.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().runtime.active.serviceTier).toBeNull();
    expect(store.getState().runtime.active.serviceTierKnown).toBe(true);

    await commands.toggleFastMode();

    expect(port.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "fast" });
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
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await commands.toggleFastMode();

    expect(port.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: "priority" });
    expect(store.getState().runtime.active.serviceTier).toBe("priority");

    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings("priority") });
    await commands.toggleFastMode();

    expect(port.updateThreadSettings).toHaveBeenLastCalledWith("thread", { serviceTier: null });
    expect(store.getState().runtime.active.serviceTier).toBeNull();
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("warns without reporting collaboration mode as applied when no effective model is available", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.setCollaborationMode("plan")).resolves.toBe(true);

    expect(port.updateThreadSettings).not.toHaveBeenCalled();
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
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    commands.requestDefaultCollaborationModeForNextTurn();

    expect(port.updateThreadSettings).not.toHaveBeenCalled();
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
          ...runtimeConfigFixture(),
          model: "gpt-config",
          reasoningEffort: "medium",
        },
      },
    });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = createChatRuntimeSettingsCommands({
      stateStore: store,
      runtimeSettingsPort: port,
      runtimeSnapshotForState: (state) => ({ ...runtimeSnapshotFixture(state), runtimeConfig: null }),
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    });

    await expect(commands.setCollaborationMode("plan")).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", {
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
    const port = settingsPortFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.active.model).toBeNull();
    expect(messages).toEqual(["nope"]);
  });

  it("leaves pending runtime intent in place when the runtime port is unavailable", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture({ updateThreadSettings: vi.fn().mockResolvedValue(false) });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(store.getState().runtime.active.model).toBeNull();
    expect(messages).toEqual([]);
  });

  it("keeps the runtime panel open when a toolbar runtime update fails", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture({ updateThreadSettings: vi.fn().mockRejectedValue(new Error("nope")) });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await commands.enableFastMode();

    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(store.getState().ui.toolbarPanel).toBe("status-panel");
    expect(messages).toEqual(["nope"]);
  });

  it("does not commit stale runtime updates after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        return true;
      }),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(activeThreadId(store.getState())).toBeNull();
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("does not report stale runtime update failures after the active thread changes", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        throw new Error("nope");
      }),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(activeThreadId(store.getState())).toBeNull();
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("does not report stale turn-submission settings failures", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        throw new Error("nope");
      }),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    store.dispatch({ type: "runtime/model-requested", model: "gpt-5.5" });

    await expect(commands.applyPendingThreadSettings()).resolves.toBe(false);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(activeThreadId(store.getState())).toBeNull();
    expect(messages).toEqual([]);
  });

  it("does not commit stale runtime updates after a newer pending intent replaces them", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const firstUpdate = deferred(true);
    const secondUpdate = deferred(true);
    const port = settingsPortFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => firstUpdate.promise)
        .mockImplementationOnce(() => secondUpdate.promise),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    const firstRequest = commands.requestModel("gpt-old");
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-old" }));

    const secondRequest = commands.requestModel("gpt-new");
    expect(port.updateThreadSettings).toHaveBeenCalledTimes(1);

    firstUpdate.resolve();
    await expect(firstRequest).resolves.toBe(false);
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "gpt-new" }));

    secondUpdate.resolve();
    await expect(secondRequest).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("does not reuse an old settings drain after the panel leaves and returns to the same thread", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const oldUpdate = deferred(true);
    const currentUpdate = deferred(true);
    const port = settingsPortFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => oldUpdate.promise)
        .mockImplementationOnce(() => currentUpdate.promise),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    const oldRequest = commands.requestModel("gpt-old");
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-old" }));

    resumeThread(store, "other");
    resumeThread(store, "thread");
    const currentRequest = commands.requestModel("gpt-new");

    expect(port.updateThreadSettings).toHaveBeenCalledOnce();
    oldUpdate.resolve();
    await expect(oldRequest).resolves.toBe(false);
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "gpt-new" }));
    currentUpdate.resolve();
    await expect(currentRequest).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    expect(messages).toEqual([]);
  });

  it("serializes runtime settings commits for the same thread across panel sessions", async () => {
    const panelState = chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } });
    const firstStore = createChatStateStore(panelState);
    const secondStore = createChatStateStore(panelState);
    const firstUpdate = deferred(true);
    const firstPort = settingsPortFixture({ updateThreadSettings: vi.fn(() => firstUpdate.promise) });
    const secondPort = settingsPortFixture();
    const threadCommits = createKeyedOperationQueue<string>();
    const firstCommands = runtimeCommandsFixture(firstStore, firstPort, [], threadCommits);
    const secondCommands = runtimeCommandsFixture(secondStore, secondPort, [], threadCommits);

    const firstMutation = firstCommands.requestModel("gpt-old");
    await vi.waitFor(() => expect(firstPort.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-old" }));
    const secondMutation = secondCommands.requestModel("gpt-latest");
    await Promise.resolve();
    expect(secondPort.updateThreadSettings).not.toHaveBeenCalled();

    firstUpdate.resolve();
    await expect(firstMutation).resolves.toBe(true);
    await vi.waitFor(() => expect(secondPort.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-latest" }));
    await expect(secondMutation).resolves.toBe(true);
  });

  it("runs A1, B, then A2 in shared thread FIFO order and leaves A2 on the server", async () => {
    const panelState = chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } });
    const firstStore = createChatStateStore(panelState);
    const secondStore = createChatStateStore(panelState);
    const firstUpdate = deferred(true);
    const order: string[] = [];
    let serverModel: string | null = null;
    const firstPort = settingsPortFixture({
      updateThreadSettings: vi.fn((_threadId, update) => {
        order.push(`A:${update.model}`);
        serverModel = update.model ?? null;
        if (update.model === "a1") return firstUpdate.promise;
        return Promise.resolve(true);
      }),
    });
    const secondPort = settingsPortFixture({
      updateThreadSettings: vi.fn((_threadId, update) => {
        order.push(`B:${update.model}`);
        serverModel = update.model ?? null;
        return Promise.resolve(true);
      }),
    });
    const threadCommits = createKeyedOperationQueue<string>();
    const firstCommands = runtimeCommandsFixture(firstStore, firstPort, [], threadCommits);
    const secondCommands = runtimeCommandsFixture(secondStore, secondPort, [], threadCommits);

    const a1 = firstCommands.requestModel("a1");
    await vi.waitFor(() => expect(firstPort.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "a1" }));
    const b = secondCommands.requestModel("b");
    const a2 = firstCommands.requestModel("a2");
    expect(order).toEqual(["A:a1"]);

    firstUpdate.resolve();

    await expect(a1).resolves.toBe(false);
    await expect(b).resolves.toBe(true);
    await expect(a2).resolves.toBe(true);
    expect(order).toEqual(["A:a1", "B:b", "A:a2"]);
    expect(serverModel).toBe("a2");
    expect(firstStore.getState().runtime.active.model).toBe("a2");
  });

  it("settles newly requested settings inside its queued turn-submission command", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const firstUpdate = deferred(true);
    const port = settingsPortFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => firstUpdate.promise)
        .mockResolvedValueOnce(true),
    });
    const commands = runtimeCommandsFixture(store, port, []);

    store.dispatch({ type: "runtime/model-requested", model: "gpt-old" });
    const settingsSettled = commands.applyPendingThreadSettings();
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-old" }));

    store.dispatch({ type: "runtime/model-requested", model: "gpt-new" });
    firstUpdate.resolve();

    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "gpt-new" }));
    await expect(settingsSettled).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
  });

  it("re-enters the shared FIFO before settling settings requested during turn submission", async () => {
    const panelState = chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } });
    const firstStore = createChatStateStore(panelState);
    const secondStore = createChatStateStore(panelState);
    const firstUpdate = deferred(true);
    const order: string[] = [];
    let serverModel: string | null = null;
    const firstPort = settingsPortFixture({
      updateThreadSettings: vi.fn((_threadId, update) => {
        order.push(`A:${update.model}`);
        serverModel = update.model ?? null;
        return update.model === "a1" ? firstUpdate.promise : Promise.resolve(true);
      }),
    });
    const secondPort = settingsPortFixture({
      updateThreadSettings: vi.fn((_threadId, update) => {
        order.push(`B:${update.model}`);
        serverModel = update.model ?? null;
        return Promise.resolve(true);
      }),
    });
    const threadCommits = createKeyedOperationQueue<string>();
    const firstCommands = runtimeCommandsFixture(firstStore, firstPort, [], threadCommits);
    const secondCommands = runtimeCommandsFixture(secondStore, secondPort, [], threadCommits);

    firstStore.dispatch({ type: "runtime/model-requested", model: "a1" });
    const settled = firstCommands.applyPendingThreadSettings();
    await vi.waitFor(() => expect(firstPort.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "a1" }));
    const b = secondCommands.requestModel("b");
    const a2 = firstCommands.requestModel("a2");

    firstUpdate.resolve();

    await expect(b).resolves.toBe(true);
    await expect(a2).resolves.toBe(true);
    await expect(settled).resolves.toBe(true);
    expect(order).toEqual(["A:a1", "B:b", "A:a2"]);
    expect(serverModel).toBe("a2");
  });

  it("serializes a different-field intent behind the active settings update", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const modelUpdate = deferred(true);
    const effortUpdate = deferred(true);
    const port = settingsPortFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => modelUpdate.promise)
        .mockImplementationOnce(() => effortUpdate.promise),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    const modelRequest = commands.requestModel("gpt-5.5");
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-5.5" }));

    const effortRequest = commands.requestReasoningEffort("high");
    expect(port.updateThreadSettings).toHaveBeenCalledTimes(1);

    modelUpdate.resolve();
    await expect(modelRequest).resolves.toBe(true);
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { effort: "high" }));
    expect(store.getState().runtime.active.model).toBe("gpt-5.5");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "high" });

    effortUpdate.resolve();
    await expect(effortRequest).resolves.toBe(true);
    expect(store.getState().runtime.active.reasoningEffort).toBe("high");
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it("resets requested model to config through an explicit command", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = chatStateWith(state, { runtime: { active: { model: "gpt-5.5" } } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.resetModelToConfig()).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: null });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.model).toBeNull();
  });

  it("enables and disables auto-review through explicit commands", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    const store = createChatStateStore(state);
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await commands.enableAutoReview();
    store.dispatch({ type: "active-thread/settings-applied", ...threadSettings(null, "auto_review") });
    await commands.disableAutoReview();

    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { approvalsReviewer: "auto_review" });
    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { approvalsReviewer: "user" });
    expect(messages).toEqual(["Auto-review on for subsequent turns.", "Auto-review off for subsequent turns."]);
  });
});

function runtimeCommandsFixture(
  store: ReturnType<typeof createChatStateStore>,
  port: RuntimeSettingsPort,
  messages: string[],
  threadCommits?: KeyedOperationQueue<string>,
): ChatRuntimeSettingsCommands {
  return createChatRuntimeSettingsCommands(
    {
      stateStore: store,
      runtimeSettingsPort: port,
      runtimeSnapshotForState: runtimeSnapshotFixture,
      collaborationModeLabel: () => "Plan",
      addSystemMessage: (text) => messages.push(text),
    },
    threadCommits,
  );
}

function settingsPortFixture(overrides: Partial<RuntimeSettingsPort> = {}): RuntimeSettingsPort {
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

function resumeThread(store: ReturnType<typeof createChatStateStore>, threadId: string): void {
  store.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: {
      id: threadId,
      preview: "",
      name: null,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      provenance: { kind: "interactive" },
    },
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
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
