import { describe, expect, it, vi } from "vitest";
import type { Thread, ThreadActivationSnapshot } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { activeThreadId, activeThreadState, newConversationEphemeral } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/transition-actions";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/submission/web-submission";
import { sideChatDraft } from "../../../../../src/features/chat/application/threads/fork-draft";
import {
  createThreadStartCommand,
  type ThreadStartCommandHost,
} from "../../../../../src/features/chat/application/threads/thread-start-command";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import { deferred } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { type ChatSharedDisplayValues, chatSharedDisplayValuesFixture } from "../../support/shared-display-values";
import { chatStateFixture } from "../../support/state";

describe("thread start commands", () => {
  it.each([false, true])("freezes creation, coalesces callers, and reuses the created identity (temporary=%s)", async (ephemeral) => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "panel/ephemeral-default-set", ephemeral });
    const creating = deferred<EffectOutcome<ThreadActivationSnapshot>>();
    const startThread = vi.fn(() => creating.promise);
    const recordStartedThread = vi.fn();
    const commands = threadStartCommands({
      stateStore,
      effects: { forkSideChat: vi.fn(), forkThread: vi.fn(), startThread },
      recordStartedThread,
    });
    const pending = commands.startThread("first prompt");
    expect(stateStore.getState().panelThread).toMatchObject({ kind: "empty", operation: "creating" });
    stateStore.dispatch({ type: "panel/ephemeral-choice-set", ephemeral: !ephemeral });
    stateStore.dispatch({ type: "panel/ephemeral-default-set", ephemeral: !ephemeral });
    expect(newConversationEphemeral(stateStore.getState())).toBe(ephemeral);
    const concurrent = commands.startThread("second prompt");
    expect(startThread).toHaveBeenCalledExactlyOnceWith({
      ...(ephemeral ? { ephemeral: true } : {}),
      serviceTier: undefined,
      permissions: undefined,
    });
    const started = threadFixture("started", { ephemeral });
    creating.resolve(completedActivation(activationFixture(started, { canAcceptDirectInput: false })));
    await pending;
    await concurrent;
    expect(activeThreadState(stateStore.getState())?.canAcceptDirectInput).toBe(false);
    expect(activeThreadState(stateStore.getState())?.lifetime).toEqual(
      ephemeral ? { kind: "ephemeral", mode: "ordinary" } : { kind: "persistent" },
    );
    if (ephemeral) expect(recordStartedThread).not.toHaveBeenCalled();
    else expect(recordStartedThread).toHaveBeenCalledExactlyOnceWith({ ...started, preview: "first prompt" });
    stateStore.dispatch({ type: "panel/ephemeral-choice-set", ephemeral: !ephemeral });
    await expect(commands.startThread("later prompt")).resolves.toMatchObject({
      kind: "created-activated",
      target: { threadId: "started" },
    });
    expect(startThread).toHaveBeenCalledOnce();
  });

  it.each([false, true])("restores ordinary retry and choice after a creation error (temporary=%s)", async (ephemeral) => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "panel/ephemeral-choice-set", ephemeral });
    const startThread = vi
      .fn()
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValue(completedActivation(activationFixture(threadFixture("retried"))));
    const commands = threadStartCommands({ stateStore, effects: { forkSideChat: vi.fn(), forkThread: vi.fn(), startThread } });
    await expect(commands.startThread()).rejects.toThrow("timed out");
    expect(stateStore.getState().panelThread).toMatchObject({ kind: "empty" });
    expect(stateStore.getState().panelThread).not.toHaveProperty("operation");
    stateStore.dispatch({ type: "panel/ephemeral-choice-set", ephemeral: false });
    expect(newConversationEphemeral(stateStore.getState())).toBe(false);
    await expect(commands.startThread()).resolves.toMatchObject({ kind: "created-activated", target: { threadId: "retried" } });
    expect(startThread).toHaveBeenCalledTimes(2);
  });

  it("honors an individual regular choice without changing the global temporary default", async () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "panel/ephemeral-default-set", ephemeral: true });
    stateStore.dispatch({ type: "panel/ephemeral-choice-set", ephemeral: false });
    const startThread = vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("regular"))));
    const commands = threadStartCommands({ stateStore, effects: { forkSideChat: vi.fn(), forkThread: vi.fn(), startThread } });
    await commands.startThread();
    expect(startThread).toHaveBeenCalledWith({ permissions: undefined, serviceTier: undefined });
    stateStore.dispatch({ type: "active-thread/cleared" });
    expect(newConversationEphemeral(stateStore.getState())).toBe(true);
  });

  it("keeps empty-panel runtime reservations when starting the first thread", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    stateStore.dispatch({
      type: "runtime/pending-intent-patched",
      patch: {
        model: { kind: "set", value: "gpt-5.5" },
        permissionProfile: { kind: "set", value: ":workspace" },
        reasoningEffort: { kind: "set", value: "high" },
        fastMode: { kind: "set", value: "enabled" },
        approvalsReviewer: { kind: "set", value: "auto_review" },
        collaborationMode: { kind: "set", value: "plan" },
      },
    });
    const startThread = vi.fn().mockResolvedValue(
      completedActivation(
        activationFixture(threadFixture("started"), {
          model: "gpt-5",
          serviceTier: "fast",
        }),
      ),
    );

    const commands = threadStartCommands({
      stateStore,
      effects: { forkSideChat: vi.fn(), forkThread: vi.fn(), startThread },
    });

    await commands.startThread("first prompt");

    expect(startThread).toHaveBeenCalledWith({
      permissions: ":workspace",
      serviceTier: undefined,
    });
    expect(stateStore.getState().runtime.active.model).toBe("gpt-5");
    expect(stateStore.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(stateStore.getState().runtime.pending.permissionProfile).toEqual({ kind: "set", value: ":workspace" });
    expect(stateStore.getState().runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(stateStore.getState().runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(stateStore.getState().runtime.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(stateStore.getState().runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("plan"));
  });

  it("does not activate a delayed new thread after its pending submission is superseded", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        phase: "cancellable",
      },
    });
    const started = deferred<EffectOutcome<ThreadActivationSnapshot>>();
    const recordStartedThread = vi.fn();
    const commands = threadStartCommands({
      stateStore,
      effects: { forkSideChat: vi.fn(), forkThread: vi.fn(), startThread: vi.fn(() => started.promise) },
      recordStartedThread,
    });

    const starting = commands.startThread(pending.text);
    stateStore.dispatch(resumedThreadAction({ response: activationFixture(threadFixture("selected")) }));
    started.resolve(completedActivation(activationFixture(threadFixture("delayed"))));

    await expect(starting).resolves.toEqual({ kind: "created-not-activated" });
    expect(activeThreadId(stateStore.getState())).toBe("selected");
    expect(recordStartedThread).toHaveBeenCalledWith(threadFixture("delayed", { preview: pending.text }));
  });

  it("starts threads with service tier and permissions from effective config", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const config = runtimeConfigFixture();
    const shared = chatSharedDisplayValuesFixture({
      runtimeConfig: {
        ...config,
        serviceTier: "flex",
        startupPermissions: {
          ...config.startupPermissions,
          activePermissionProfile: { id: ":workspace", extends: null },
        },
      },
    });
    const startThread = vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started"))));
    const commands = threadStartCommands({
      stateStore,
      effects: { forkSideChat: vi.fn(), forkThread: vi.fn(), startThread },
      runtimeSnapshotForState: runtimeSnapshotForShared(shared),
    });

    await commands.startThread();

    expect(startThread).toHaveBeenCalledWith({ serviceTier: "flex", permissions: ":workspace" });
  });

  it("keeps app-server preview when newly started threads already have one", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const started = threadFixture("started", { preview: "server preview" });
    const recordStartedThread = vi.fn();
    const commands = threadStartCommands({
      stateStore,
      effects: {
        forkSideChat: vi.fn(),
        forkThread: vi.fn(),
        startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(started))),
      },
      recordStartedThread,
    });

    await commands.startThread("local preview");

    expect(recordStartedThread).toHaveBeenCalledWith(started);
  });

  it("does not apply newly started threads after the port returns no activation", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const recordStartedThread = vi.fn();
    const commands = threadStartCommands({
      stateStore,
      effects: { forkSideChat: vi.fn(), forkThread: vi.fn(), startThread: vi.fn().mockResolvedValue({ kind: "not-started" }) },
      recordStartedThread,
    });

    await expect(commands.startThread("local preview")).resolves.toEqual({ kind: "not-started" });
    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(recordStartedThread).not.toHaveBeenCalled();
  });
  it("inherits independent side settings and adopts the server response without publishing history", async () => {
    const parent = createChatStateStore();
    parent.dispatch(
      resumedThreadAction({
        response: activationFixture(threadFixture("parent"), {
          approvalPolicyKnown: true,
          permissionProfileKnown: true,
          sandboxPolicyKnown: true,
          model: "parent-model",
          reasoningEffort: "high",
          serviceTier: "fast",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          activePermissionProfile: { id: "trusted", extends: null },
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: ["/vault"],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
          collaborationMode: "plan",
        }),
      }),
    );
    const snapshot = sideChatDraft("parent", "Parent", parent.getState().runtime);
    const stateStore = createChatStateStore();
    stateStore.dispatch({
      type: "panel/fork-draft-applied",
      preparation: snapshot,
    });
    parent.dispatch(resumedThreadAction({ response: activationFixture(threadFixture("parent"), { model: "changed-parent" }) }));
    const response = completedActivation(activationFixture(threadFixture("child"), { model: "server-model", approvalPolicy: "never" }));
    const forkThread = vi.fn().mockResolvedValue(response);
    const createSideChat = vi.fn().mockResolvedValue(response);
    const hydrateCreatedFork = vi.fn();
    const recordStartedThread = vi.fn();
    const commands = threadStartCommands({
      stateStore,
      effects: { forkSideChat: createSideChat, forkThread, startThread: vi.fn() },
      hydrateCreatedFork,
      recordStartedThread,
    });
    await commands.startThread();
    const inherited = {
      model: "parent-model",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      permissions: "trusted",
    };
    expect(createSideChat).toHaveBeenCalledWith("parent", inherited, expect.any(Function));
    expect(forkThread).not.toHaveBeenCalled();
    expect(hydrateCreatedFork).not.toHaveBeenCalled();
    expect(recordStartedThread).not.toHaveBeenCalled();
    expect(stateStore.getState().threadStream.stableItems).toEqual([]);
    expect(stateStore.getState().runtime.active.model).toBe("server-model");
    expect(stateStore.getState().runtime.active.approvalPolicy).toBe("never");
    expect(stateStore.getState().runtime.pending.collaborationMode).toEqual({ kind: "set", value: "plan" });
  });
});

function threadStartCommands(overrides: Pick<ThreadStartCommandHost, "stateStore" | "effects"> & Partial<ThreadStartCommandHost>) {
  return createThreadStartCommand({
    withThreadActivation: async (operation) => operation(),
    onThreadActivated: vi.fn(),
    hydrateCreatedFork: vi.fn(),
    runtimeSnapshotForState: runtimeSnapshotForShared(chatSharedDisplayValuesFixture()),
    recordStartedThread: vi.fn(),
    ...overrides,
  });
}

function runtimeSnapshotForShared(shared: ChatSharedDisplayValues) {
  return (state: Parameters<typeof runtimeSnapshotForChatState>[0]) =>
    runtimeSnapshotForChatState(state, {
      runtimeConfigSnapshot: () => shared.runtimeConfig,
      rateLimitsSnapshot: () => shared.rateLimit,
      modelsSnapshot: () => shared.availableModels,
    });
}

function threadFixture(id: string, overrides: Partial<Thread> = {}): Thread {
  return panelThreadFixture({
    id,
    createdAt: 0,
    updatedAt: 0,
    recencyAt: null,
    ...overrides,
  });
}

function activationFixture(thread: Thread, overrides: Partial<ThreadActivationSnapshot> = {}): ThreadActivationSnapshot {
  return threadActivationFixture(thread, {
    model: "gpt-5",
    approvalPolicyKnown: false,
    sandboxPolicyKnown: false,
    permissionProfileKnown: false,
    ...overrides,
  });
}

function completedActivation(value: ThreadActivationSnapshot): EffectOutcome<ThreadActivationSnapshot> {
  return { kind: "completed", value };
}
