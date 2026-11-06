// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ModelMetadata } from "../../../../../src/domain/runtime/catalog";
import {
  type ChatRuntimeSettingsCommands,
  createChatRuntimeSettingsCommands,
  type RuntimeSettingsPort,
  type RuntimeSettingsUpdateResult,
} from "../../../../../src/features/chat/application/runtime/settings-commands";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { activeThreadId, type ChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { sideChatDraft } from "../../../../../src/features/chat/application/threads/fork-draft";
import {
  resetRuntimeIntentToConfig,
  setCollaborationModeIntent,
  setRuntimeIntentValue,
} from "../../../../../src/features/chat/domain/runtime/intent";
import { deferred } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("createChatRuntimeSettingsCommands", () => {
  it.each(["panel/disposed", "connection/scoped-cleared", "connection/status-set"] as const)(
    "cancels settings confirmation on %s",
    async (type) => {
      const store = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }));
      const port = settingsPortFixture();
      const commands = runtimeCommandsFixture(store, port, [], {}, []);
      const request = commands.requestModel("gpt-new");
      await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenCalledOnce());
      store.dispatch(
        type === "connection/status-set"
          ? { type, statusText: "Disconnected", phase: { kind: "disconnected", message: "Disconnected" } }
          : { type },
      );
      await expect(request).resolves.toBe(false);
    },
  );

  it("cancels even after notification when acknowledgement is pending and ignores its late failure", async () => {
    const store = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }));
    const accepted = deferred<RuntimeSettingsUpdateResult>();
    const port = settingsPortFixture({ updateThreadSettings: vi.fn().mockImplementation(() => accepted.promise) });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages, {}, []);
    const request = commands.requestModel("gpt-new");
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenCalledOnce());
    applySettingsNotification(store, { model: "gpt-new" });
    store.dispatch({ type: "panel/disposed" });
    await expect(request).resolves.toBe(false);
    accepted.reject(new Error("late settings failure"));
    await accepted.promise.catch(() => undefined);
    expect(messages).toEqual([]);
  });

  it("refreshes after a timeout without retrying the submitted change or consuming a newer change", async () => {
    vi.useFakeTimers();
    try {
      const store = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }));
      const port = settingsPortFixture({
        readThreadSettings: vi.fn(async (_thread, onSettings) => {
          onSettings(store.getState().runtime.active);
          return true;
        }),
      });
      const messages: string[] = [];
      const commands = runtimeCommandsFixture(store, port, messages);
      const old = commands.requestModel("model-B");
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(old).resolves.toBe(false);
      expect(store.getState().runtime.active.model).toBeNull();
      expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
      expect(messages).toEqual(["Settings refreshed. The previous change could not be confirmed."]);
      expect(vi.getTimerCount()).toBe(0);

      let resolved = false;
      const current = commands.requestModel("model-C").then((ok) => {
        resolved = true;
        return ok;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "model-C" });
      applySettingsNotification(store, { model: "model-B" });
      await vi.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);
      expect(store.getState().runtime.active.model).toBe("model-B");
      expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "model-C" });
      applySettingsNotification(store, { model: "model-C" });
      await expect(current).resolves.toBe(true);
      expect(store.getState().runtime.active.model).toBe("model-C");
      expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
      expect(port.updateThreadSettings).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a same-value update without requiring a notification", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" }, runtime: { active: { model: "same" } } }));
    const port = settingsPortFixture();
    const commands = runtimeCommandsFixture(store, port, []);
    await expect(commands.requestModel("same")).resolves.toBe(true);
    expect(port.readThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.model.kind).toBe("unchanged");
  });

  it("rejects only the submitted intent while retaining a newer edit", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
    const response = deferred<RuntimeSettingsUpdateResult>();
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue({ kind: "accepted" }),
    });
    const commands = runtimeCommandsFixture(store, port, [], {}, [{}, { model: "newer" }]);
    const first = commands.requestModel("rejected");
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenCalledOnce());
    const second = commands.requestModel("newer");
    response.resolve({ kind: "rejected", message: "not allowed" });
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "newer" });
    expect(store.getState().runtime.active.model).toBe("newer");
  });

  it("keeps a draft after an unconfirmed auto-review change and allows an explicitly configured next turn", async () => {
    const store = createChatStateStore(
      chatStateFixture({
        activeThread: { id: "fresh" },
        composer: { draft: "Keep my draft" },
        runtime: { active: { approvalsReviewer: "user" } },
      }),
    );
    const port = settingsPortFixture({ updateThreadSettings: vi.fn().mockResolvedValue({ kind: "unknown" }) });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);
    await commands.toggleAutoReview();
    expect(store.getState().composer.draft).toBe("Keep my draft");
    expect(store.getState().runtime.settingsStatus).toBe("auto-review-unconfirmed");
    expect(store.getState().runtime.pending.approvalsReviewer.kind).toBe("unchanged");
    await expect(commands.applyPendingThreadSettings()).resolves.toBe(true);
    expect(port.updateThreadSettings).toHaveBeenCalledOnce();
    expect(messages).toEqual([
      "Could not confirm the change. Auto-review was last confirmed off. This setting will be requested for the next turn.",
    ]);
  });

  it("does not use auto-review recovery for unconfirmed model settings", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" }, composer: { draft: "Keep this" } }));
    const port = settingsPortFixture({ updateThreadSettings: vi.fn().mockResolvedValue({ kind: "unknown" }) });
    const commands = runtimeCommandsFixture(store, port, []);
    await expect(commands.requestModel("unknown")).resolves.toBe(false);
    expect(store.getState().runtime.settingsStatus).toBe("unavailable");
    await expect(commands.applyPendingThreadSettings()).resolves.toBe(false);
    expect(port.updateThreadSettings).toHaveBeenCalledOnce();
    expect(store.getState().composer.draft).toBe("Keep this");
    reopenThread(store);
    await expect(commands.applyPendingThreadSettings()).resolves.toBe(true);
    expect(port.updateThreadSettings).toHaveBeenCalledOnce();
  });

  it.each(["model", "auto-review"] as const)("holds a send already queued when a %s change becomes unconfirmed", async (field) => {
    const store = createChatStateStore(
      chatStateFixture({ activeThread: { id: "thread" }, runtime: { active: { approvalsReviewer: "user" } } }),
    );
    const response = deferred<RuntimeSettingsUpdateResult>();
    const port = settingsPortFixture({ updateThreadSettings: vi.fn().mockReturnValue(response.promise) });
    const commands = runtimeCommandsFixture(store, port, []);
    const changing = field === "model" ? commands.requestModel("next") : commands.toggleAutoReview();
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenCalledOnce());
    const sending = commands.applyPendingThreadSettings();
    response.resolve({ kind: "unknown" });
    await changing;
    await expect(sending).resolves.toBe(false);
    expect(port.updateThreadSettings).toHaveBeenCalledOnce();
  });

  it("keeps a newer settings notification when the recovery read fails", async () => {
    const store = createChatStateStore(
      chatStateFixture({ activeThread: { id: "thread" }, runtime: { active: { approvalsReviewer: "user" } } }),
    );
    const read = deferred<boolean>();
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockResolvedValue({ kind: "unknown" }),
      readThreadSettings: vi.fn(() => read.promise),
    });
    const commands = runtimeCommandsFixture(store, port, []);
    const changing = commands.toggleAutoReview();
    await vi.waitFor(() => expect(port.readThreadSettings).toHaveBeenCalledOnce());
    applySettingsNotification(store, { approvalsReviewer: "auto_review" });
    read.reject(new Error("connection interrupted"));
    await changing;
    expect(store.getState().runtime.settingsStatus).toBe("current");
    expect(store.getState().runtime.active.approvalsReviewer).toBe("auto_review");
  });

  it("does not announce success when a later notification supersedes the requested value before acknowledgement", async () => {
    const store = createChatStateStore(
      chatStateFixture({ activeThread: { id: "thread" }, runtime: { active: { approvalsReviewer: "user" } } }),
    );
    const response = deferred<RuntimeSettingsUpdateResult>();
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn(() => response.promise),
      readThreadSettings: vi.fn(async (_id, onSettings) => {
        onSettings(store.getState().runtime.active);
        return true;
      }),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);
    const changing = commands.toggleAutoReview();
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenCalledOnce());
    applySettingsNotification(store, { approvalsReviewer: "auto_review" });
    applySettingsNotification(store, { approvalsReviewer: "user" });
    response.resolve({ kind: "accepted" });
    await changing;
    expect(messages).toEqual(["Settings refreshed. The previous change could not be confirmed."]);
    expect(store.getState().runtime.active.approvalsReviewer).toBe("user");
  });

  it("allows a new explicit settings choice after a failed recovery read", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockResolvedValueOnce({ kind: "unknown" }).mockResolvedValueOnce({ kind: "accepted" }),
    });
    const commands = runtimeCommandsFixture(store, port, [], {}, [{}, { model: "chosen-again" }]);
    await expect(commands.requestModel("uncertain")).resolves.toBe(false);
    expect(store.getState().runtime.settingsStatus).toBe("unavailable");
    await expect(commands.requestModel("chosen-again")).resolves.toBe(true);
    expect(store.getState().runtime.settingsStatus).toBe("current");
    expect(store.getState().runtime.active.model).toBe("chosen-again");
  });

  it("does not send an auto-review change forbidden by explicit requirements", async () => {
    const store = createChatStateStore(
      chatStateFixture({ activeThread: { id: "thread" }, runtime: { active: { approvalsReviewer: "user" } } }),
    );
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages, {
      runtimeConfig: runtimeConfigFixture({ allowedApprovalsReviewers: ["user"] }),
    });
    await commands.toggleAutoReview();
    expect(port.updateThreadSettings).not.toHaveBeenCalled();
    expect(store.getState().runtime.pending.approvalsReviewer.kind).toBe("unchanged");
    expect(messages[0]).toContain("cannot be turned on");
  });

  it.each(["persistent", "ephemeral"] as const)("requests and resets permission profiles in a %s thread", async (kind) => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "thread",
        lifetime:
          kind === "ephemeral" ? { kind, mode: "side-chat" as const, sourceThreadId: "source", sourceThreadTitle: "Source" } : { kind },
      },
    });
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
    const commands = runtimeCommandsFixture(
      store,
      port,
      messages,
      {
        runtimeConfig: runtimeConfigFixture({
          model: "gpt-5.5",
          startupPermissions: { approvalPolicy: null, sandboxPolicy: null, activePermissionProfile: { id: ":read-only", extends: null } },
        }),
      },
      [
        {
          activePermissionProfile: { id: ":workspace", extends: null },
          permissionProfileKnown: true,
          sandboxPolicy: null,
          sandboxPolicyKnown: true,
        },
        { activePermissionProfile: { id: ":read-only", extends: null }, permissionProfileKnown: true },
      ],
    );

    await expect(commands.requestPermissionProfile(":workspace")).resolves.toBe(true);
    expect(store.getState().runtime.active).toMatchObject({
      activePermissionProfile: { id: ":workspace", extends: null },
      permissionProfileKnown: true,
      sandboxPolicy: null,
      sandboxPolicyKnown: true,
    });
    await expect(commands.resetPermissionProfileToConfig()).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { permissions: ":workspace" });
    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { permissions: ":read-only" });
    expect(store.getState().runtime.pending.permissionProfile).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.activePermissionProfile).toEqual({ id: ":read-only", extends: null });
    expect(store.getState().runtime.active.permissionProfileKnown).toBe(true);
    expect(messages).toEqual([]);
  });

  it("blocks all thread setting changes for subagent threads", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "child",
        provenance: {
          kind: "subagent",
          parentThreadId: "parent",
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
    await commands.toggleFastMode();
    await commands.toggleAutoReview();

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
    await commands.toggleFastMode();
    await commands.toggleAutoReview();
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

  it("rejects an explicit reasoning effort that the selected model does not support", async () => {
    const store = createChatStateStore(chatStateFixture());
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages, {
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [modelFixture("gpt-5.5", "fast", ["low", "medium"])],
    });

    await expect(commands.requestReasoningEffort("ultra")).resolves.toBe(false);

    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
    expect(port.updateThreadSettings).not.toHaveBeenCalled();
    expect(messages).toEqual(["Reasoning effort ultra is unavailable for gpt-5.5. Supported: low, medium."]);
  });

  it("normalizes a pending reasoning intent when changing models", async () => {
    const store = createChatStateStore(chatStateFixture());
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages, {
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }),
      availableModels: [modelFixture("gpt-5.5", "fast"), modelFixture("gpt-5.4-mini", "fast", ["low", "medium"])],
    });

    await expect(commands.requestReasoningEffort("high")).resolves.toBe(true);
    const pendingSnapshots: unknown[] = [];
    store.subscribe(() => {
      pendingSnapshots.push(store.getState().runtime.pending);
    });
    await expect(commands.requestModel("gpt-5.4-mini")).resolves.toBe(true);

    expect(pendingSnapshots).toEqual([
      expect.objectContaining({
        reasoningEffort: { kind: "set", value: "medium" },
        model: { kind: "set", value: "gpt-5.4-mini" },
      }),
    ]);
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "medium" });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.4-mini" });
    expect(port.updateThreadSettings).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
  });

  it.each(["request", "reset"] as const)("updates model and normalized effort atomically through %s", async (kind) => {
    const store = createChatStateStore(
      chatStateFixture({
        activeThread: { id: "thread" },
        runtime: { active: { model: "gpt-5.5", reasoningEffort: "high" } },
      }),
    );
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(
      store,
      port,
      messages,
      {
        runtimeConfig: runtimeConfigFixture({ model: kind === "reset" ? "gpt-5.4-mini" : "gpt-5.5", reasoningEffort: "high" }),
        availableModels: [modelFixture("gpt-5.5", "fast"), modelFixture("gpt-5.4-mini", "fast", ["low", "medium"])],
      },
      [{ model: "gpt-5.4-mini", reasoningEffort: "medium" }],
    );

    await expect(kind === "request" ? commands.requestModel("gpt-5.4-mini") : commands.resetModelToConfig()).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.4-mini", effort: "medium" });
    expect(store.getState().runtime.active.model).toBe("gpt-5.4-mini");
    expect(store.getState().runtime.active.reasoningEffort).toBe("medium");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it.each([null, "low"] as const)(
    "preserves server effort or pending %s effort when the selected model exposes no reasoning efforts",
    async (pendingEffort) => {
      let state = chatStateFixture();
      state = chatStateWith(state, { activeThread: { id: "thread" } });
      state = chatStateWith(state, { runtime: { active: { model: "gpt-5.5", reasoningEffort: "high" } } });
      if (pendingEffort) state = chatStateWith(state, { runtime: { pending: { reasoningEffort: setRuntimeIntentValue(pendingEffort) } } });
      const store = createChatStateStore(state);
      const port = settingsPortFixture();
      const commands = runtimeCommandsFixture(
        store,
        port,
        [],
        {
          runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", reasoningEffort: "high" }),
          availableModels: [
            modelFixture("gpt-5.5", "fast"),
            {
              ...modelFixture("non-reasoning-model", "fast"),
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
            },
          ],
        },
        [{ model: "non-reasoning-model", reasoningEffort: pendingEffort ?? "high" }],
      );

      await expect(commands.requestModel("non-reasoning-model")).resolves.toBe(true);

      expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", {
        model: "non-reasoning-model",
        ...(pendingEffort ? { effort: pendingEffort } : {}),
      });
      expect(store.getState().runtime.active.model).toBe("non-reasoning-model");
      expect(store.getState().runtime.active.reasoningEffort).toBe(pendingEffort ?? "high");
    },
  );

  it.each(["fast", "priority"])("confirms rapid Fast toggles with catalog tier %s above configured Fast", async (tier) => {
    const store = createChatStateStore(
      chatStateWith(chatStateFixture(), {
        activeThread: { id: "thread" },
        runtime: { active: { model: "gpt-5.5", serviceTier: "priority", serviceTierKnown: true } },
        ui: { toolbarPanel: "status-panel" },
      }),
    );
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages, {
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", serviceTier: "fast" }),
      availableModels: [modelFixture("gpt-5.5", tier)],
    });

    const disabled = commands.toggleFastMode();
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { serviceTier: null }));
    expect(store.getState().runtime.active.serviceTier).toBe("priority");
    expect(store.getState().ui.toolbarPanel).toBe("status-panel");
    const enabled = commands.toggleFastMode();
    expect(port.updateThreadSettings).toHaveBeenCalledOnce();
    applySettingsNotification(store, { serviceTier: "default", serviceTierKnown: true });
    await disabled;
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { serviceTier: tier }));
    expect(store.getState().runtime.active.serviceTier).toBe("default");
    applySettingsNotification(store, { serviceTier: "priority", serviceTierKnown: true });
    await enabled;

    expect(store.getState().runtime.active.serviceTier).toBe("priority");
    expect(store.getState().runtime.pending.fastMode).toEqual({ kind: "unchanged" });
    expect(store.getState().ui.toolbarPanel).toBeNull();
    const disabledAgain = commands.toggleFastMode();
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(3, "thread", { serviceTier: null }));
    applySettingsNotification(store, { serviceTier: "default", serviceTierKnown: true });
    await disabledAgain;
    expect(store.getState().runtime.active.serviceTier).toBe("default");
    await expect(commands.applyPendingThreadSettings()).resolves.toBe(true);
    expect(port.updateThreadSettings).toHaveBeenCalledTimes(3);
    expect(messages).toEqual(["Fast mode on for subsequent turns.", "Fast mode off for subsequent turns."]);
  });

  it("warns without reporting collaboration mode as applied when no effective model is available", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages, {
      runtimeConfig: runtimeConfigFixture({ model: null }),
      availableModels: [],
    });

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

  it.each(["rejected", "unavailable"] as const)(
    "discards rejected changes and preserves changes that were never sent (%s)",
    async (outcome) => {
      const store = createChatStateStore(
        chatStateWith(chatStateFixture(), { activeThread: { id: "thread" }, ui: { toolbarPanel: "status-panel" } }),
      );
      const updateThreadSettings = vi.fn();
      if (outcome === "rejected") updateThreadSettings.mockResolvedValue({ kind: "rejected", message: "nope" });
      else updateThreadSettings.mockResolvedValue({ kind: "not-started" });
      const port = settingsPortFixture({ updateThreadSettings });
      const messages: string[] = [];
      const commands = runtimeCommandsFixture(store, port, messages);

      await commands.toggleFastMode();

      expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { serviceTier: "fast" });
      expect(store.getState().runtime.pending.fastMode).toEqual(
        outcome === "rejected" ? { kind: "unchanged" } : { kind: "set", value: "enabled" },
      );
      expect(store.getState().runtime.active.serviceTierKnown).toBe(false);
      expect(store.getState().ui.toolbarPanel).toBe("status-panel");
      expect(messages).toEqual(outcome === "rejected" ? ["Codex did not accept the settings change: nope"] : []);
    },
  );

  it("does not commit stale runtime updates after returning to the same thread", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        reopenThread(store);
        store.dispatch({ type: "runtime/pending-intent-patched", patch: { model: { kind: "set", value: "gpt-5.5" } } });
        return { kind: "accepted" };
      }),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-5.5" });
    expect(activeThreadId(store.getState())).toBe("thread");
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(messages).toEqual([]);
  });

  it("does not report stale runtime update failures after returning to the same thread", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockImplementation(async () => {
        store.dispatch({ type: "active-thread/cleared" });
        reopenThread(store);
        return { kind: "rejected", message: "nope" };
      }),
    });
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages);

    await expect(commands.requestModel("gpt-5.5")).resolves.toBe(false);

    expect(activeThreadId(store.getState())).toBe("thread");
    expect(store.getState().runtime.active.model).toBeNull();
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(messages).toEqual([]);
  });

  it.each([true, false])("carries normalized effort through consecutive models (first accepted=%s)", async (accepted) => {
    const store = createChatStateStore(
      chatStateFixture({
        activeThread: { id: "thread" },
        runtime: { active: { model: "gpt-5.5", reasoningEffort: "high" } },
      }),
    );
    const firstUpdate = deferred<RuntimeSettingsUpdateResult>();
    const secondUpdate = deferred<RuntimeSettingsUpdateResult>();
    const port = settingsPortFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => firstUpdate.promise)
        .mockImplementationOnce(() => secondUpdate.promise),
    });
    const commands = runtimeCommandsFixture(
      store,
      port,
      [],
      {
        runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", reasoningEffort: "high" }),
        availableModels: [
          modelFixture("gpt-5.5", "fast"),
          modelFixture("gpt-mini", "fast", ["medium"]),
          modelFixture("gpt-next", "fast", ["medium"]),
        ],
      },
      [
        { model: "gpt-mini", reasoningEffort: "medium" },
        { model: "gpt-next", reasoningEffort: "medium" },
      ],
    );

    const firstRequest = commands.requestModel("gpt-mini");
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-mini", effort: "medium" }));
    const secondRequest = commands.requestModel("gpt-next");

    firstUpdate.resolve(accepted ? { kind: "accepted" } : { kind: "not-started" });
    await expect(firstRequest).resolves.toBe(false);
    await vi.waitFor(() =>
      expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", {
        model: "gpt-next",
        ...(accepted ? {} : { effort: "medium" }),
      }),
    );
    expect(store.getState().runtime.active.model).toBe(accepted ? "gpt-mini" : "gpt-5.5");
    expect(store.getState().runtime.active.reasoningEffort).toBe(accepted ? "medium" : "high");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-next" });
    secondUpdate.resolve({ kind: "accepted" });

    await expect(secondRequest).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-next");
    expect(store.getState().runtime.active.reasoningEffort).toBe("medium");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
  });

  it("commits the model anchor when effort changes during a normalized model update", async () => {
    const store = createChatStateStore(
      chatStateFixture({
        activeThread: { id: "thread" },
        runtime: { active: { model: "gpt-5.5", reasoningEffort: "high" } },
      }),
    );
    const modelUpdate = deferred<RuntimeSettingsUpdateResult>();
    const effortUpdate = deferred<RuntimeSettingsUpdateResult>();
    const port = settingsPortFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => modelUpdate.promise)
        .mockImplementationOnce(() => effortUpdate.promise),
    });
    const commands = runtimeCommandsFixture(
      store,
      port,
      [],
      {
        runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", reasoningEffort: "high" }),
        availableModels: [modelFixture("gpt-5.5", "fast"), modelFixture("gpt-mini", "fast", ["low", "medium"])],
      },
      [{ model: "gpt-mini", reasoningEffort: "medium" }, { reasoningEffort: "low" }],
    );

    const modelRequest = commands.requestModel("gpt-mini");
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-mini", effort: "medium" }));
    const effortRequest = commands.requestReasoningEffort("low");
    modelUpdate.resolve({ kind: "accepted" });

    await expect(modelRequest).resolves.toBe(false);
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { effort: "low" }));
    effortUpdate.resolve({ kind: "accepted" });

    await expect(effortRequest).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-mini");
    expect(store.getState().runtime.active.reasoningEffort).toBe("low");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
  });

  it("settles newly requested settings inside its queued turn-submission command", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
    const firstUpdate = deferred<RuntimeSettingsUpdateResult>();
    const port = settingsPortFixture({
      updateThreadSettings: vi
        .fn()
        .mockImplementationOnce(() => firstUpdate.promise)
        .mockResolvedValueOnce({ kind: "accepted" }),
    });
    const commands = runtimeCommandsFixture(store, port, [], {}, [{ model: "gpt-old" }, { model: "gpt-new" }]);

    store.dispatch({ type: "runtime/pending-intent-patched", patch: { model: { kind: "set", value: "gpt-old" } } });
    const settingsSettled = commands.applyPendingThreadSettings();
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { model: "gpt-old" }));

    store.dispatch({ type: "runtime/pending-intent-patched", patch: { model: { kind: "set", value: "gpt-new" } } });
    firstUpdate.resolve({ kind: "accepted" });

    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { model: "gpt-new" }));
    await expect(settingsSettled).resolves.toBe(true);
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
  });

  it.each(["effort", "plan"] as const)("waits for model notification before its dependent %s UI update", async (following) => {
    const store = createChatStateStore(
      chatStateWith(chatStateFixture(), {
        activeThread: { id: "thread" },
        runtime: { active: { model: "gpt-old" } },
      }),
    );
    const port = settingsPortFixture();
    const commands = runtimeCommandsFixture(store, port, [], {
      availableModels: [modelFixture("gpt-old", "fast"), modelFixture("gpt-new", "fast")],
    });
    let completed = false;
    const model = commands.requestModel("gpt-new").then((ok) => {
      completed = true;
      return ok;
    });
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenCalledWith("thread", { model: "gpt-new" }));
    expect(completed).toBe(false);
    expect(store.getState().runtime.active.model).toBe("gpt-old");
    expect(store.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-new" });
    const dependent = following === "effort" ? commands.requestReasoningEffortFromUi("high") : commands.toggleCollaborationMode();
    expect(port.updateThreadSettings).toHaveBeenCalledOnce();
    applySettingsNotification(store, { model: "gpt-new" });
    await expect(model).resolves.toBe(true);
    const update =
      following === "effort"
        ? { effort: "high" }
        : {
            collaborationMode: { mode: "plan", settings: { model: "gpt-new", reasoningEffort: null, developerInstructions: null } },
          };
    await vi.waitFor(() => expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", update));
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.active.model).toBe("gpt-new");
    applySettingsNotification(store, following === "effort" ? { reasoningEffort: "high" } : { collaborationMode: "plan" });
    await dependent;
    expect(store.getState().runtime.pending.reasoningEffort).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.pending.collaborationMode).toEqual({ kind: "unchanged" });
  });

  it("reconciles a failed model request together with its dependent Plan request", async () => {
    const store = createChatStateStore(
      chatStateWith(chatStateFixture(), {
        activeThread: { id: "thread" },
        runtime: { active: { model: "gpt-old" } },
      }),
    );
    const port = settingsPortFixture({
      updateThreadSettings: vi.fn().mockResolvedValueOnce({ kind: "not-started" }).mockResolvedValueOnce({ kind: "accepted" }),
    });
    const commands = runtimeCommandsFixture(store, port, [], {}, [{ model: "gpt-new" }, { model: "gpt-new", collaborationMode: "plan" }]);
    await expect(commands.requestModel("gpt-new")).resolves.toBe(false);
    expect(store.getState().runtime.active.model).toBe("gpt-old");

    await expect(commands.setCollaborationMode("plan")).resolves.toBe(true);

    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", {
      model: "gpt-new",
      collaborationMode: { mode: "plan", settings: { model: "gpt-new", reasoningEffort: null, developerInstructions: null } },
    });
    expect(store.getState().runtime.pending.model).toEqual({ kind: "unchanged" });
    expect(store.getState().runtime.pending.collaborationMode).toEqual({ kind: "unchanged" });
  });

  it.each([
    ["model", "resetModelToConfig", "model"],
    ["reasoning effort", "resetReasoningEffortToConfig", "reasoningEffort"],
    ["permission profile", "resetPermissionProfileToConfig", "permissionProfile"],
  ] as const)("handles unknown configured %s reset for active threads, fork drafts, and empty panels", async (label, command, field) => {
    for (const target of ["active", "fork-draft", "empty"] as const) {
      const store = createChatStateStore(
        target === "active" ? chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }) : chatStateFixture(),
      );
      if (target === "fork-draft") store.dispatch({ type: "panel/fork-draft-applied", preparation: sideChatDraft("parent", "Parent") });
      store.dispatch({ type: "runtime/pending-intent-patched", patch: { [field]: resetRuntimeIntentToConfig() } });
      const port = settingsPortFixture();
      const messages: string[] = [];
      const commands = runtimeCommandsFixture(store, port, messages, { runtimeConfig: runtimeConfigFixture() });
      const before = store.getState();
      await expect(commands[command](), target).resolves.toBe(target === "empty");
      const expectedState =
        target === "empty"
          ? { ...before, runtime: { ...before.runtime, pending: { ...before.runtime.pending, [field]: { kind: "unchanged" } } } }
          : before;
      expect(store.getState(), target).toEqual(expectedState);
      expect(port.updateThreadSettings, target).not.toHaveBeenCalled();
      expect(messages, target).toEqual(
        target === "empty"
          ? []
          : [`Cannot reset ${label}: no configured value is available. Choose an explicit value or start a new thread.`],
      );
    }
  });

  it("toggles auto-review and reports the user-visible result", async () => {
    const store = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
    const port = settingsPortFixture();
    const messages: string[] = [];
    const commands = runtimeCommandsFixture(store, port, messages, {}, [
      { approvalsReviewer: "auto_review" },
      { approvalsReviewer: "user" },
    ]);

    await commands.toggleAutoReview();
    await commands.toggleAutoReview();

    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(1, "thread", { approvalsReviewer: "auto_review" });
    expect(port.updateThreadSettings).toHaveBeenNthCalledWith(2, "thread", { approvalsReviewer: "user" });
    expect(messages).toEqual(["Auto-review on for subsequent turns.", "Auto-review off for subsequent turns."]);
  });
});

function runtimeCommandsFixture(
  store: ReturnType<typeof createChatStateStore>,
  port: RuntimeSettingsPort,
  messages: string[],
  shared: RuntimeSnapshotFixtureShared = {},
  notifications: readonly Partial<ChatState["runtime"]["active"]>[] = [],
): ChatRuntimeSettingsCommands {
  let notificationIndex = 0;
  return createChatRuntimeSettingsCommands({
    stateStore: store,
    runtimeSettingsPort: {
      readThreadSettings: port.readThreadSettings,
      updateThreadSettings: async (threadId, update) => {
        const revision = store.getState().panelTargetRevision;
        const notification = notifications[notificationIndex++];
        const accepted = await port.updateThreadSettings(threadId, update);
        if (
          accepted.kind === "accepted" &&
          notification &&
          activeThreadId(store.getState()) === threadId &&
          store.getState().panelTargetRevision === revision
        ) {
          applySettingsNotification(store, notification);
        }
        return accepted;
      },
    },
    runtimeSnapshotForState: (state) => runtimeSnapshotFixture(state, shared),
    collaborationModeLabel: () => "Plan",
    addSystemMessage: (text) => messages.push(text),
  });
}

function settingsPortFixture(overrides: Partial<RuntimeSettingsPort> = {}): RuntimeSettingsPort {
  return {
    updateThreadSettings: vi.fn().mockResolvedValue({ kind: "accepted" }),
    readThreadSettings: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

interface RuntimeSnapshotFixtureShared {
  runtimeConfig?: ReturnType<typeof runtimeConfigFixture>;
  availableModels?: readonly ModelMetadata[];
}

function runtimeSnapshotFixture(state: ChatState, shared: RuntimeSnapshotFixtureShared = {}) {
  return runtimeSnapshotForChatState(state, {
    runtimeConfigSnapshot: () => shared.runtimeConfig ?? runtimeConfigFixture({ model: "gpt-5.5" }),
    rateLimitsSnapshot: () => undefined,
    modelsSnapshot: () => shared.availableModels ?? [modelFixture("gpt-5.5", "fast")],
  });
}

function modelFixture(model: string, fastTierId: string, efforts: readonly string[] = ["low", "medium", "high"]): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: "" })),
    defaultReasoningEffort: "medium",
    inputModalities: [],
    serviceTiers: [{ id: fastTierId, name: "Fast" }],
    defaultServiceTier: null,
    isDefault: true,
  };
}

function reopenThread(store: ReturnType<typeof createChatStateStore>): void {
  store.dispatch({
    ...threadActivationFixture(
      panelThreadFixture({
        id: "thread",
        preview: "Thread",
      }),
    ),
    type: "active-thread/resumed",
  });
}

function applySettingsNotification(store: ReturnType<typeof createChatStateStore>, patch: Partial<ChatState["runtime"]["active"]>): void {
  const active = { ...store.getState().runtime.active, ...patch };
  store.dispatch({ type: "active-thread/settings-applied", ...active, collaborationMode: active.collaborationMode ?? "default" });
}
