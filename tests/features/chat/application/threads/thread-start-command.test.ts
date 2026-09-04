import { describe, expect, it, vi } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { activeThreadId, activeThreadState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/transition-actions";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/submission/web-submission";
import { createThreadStartCommand } from "../../../../../src/features/chat/application/threads/thread-start-command";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import { deferred } from "../../../../support/async";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { type ChatSharedDisplayValues, chatSharedResourcesFixture } from "../../support/shared-display-values";
import { chatStateFixture } from "../../support/state";

describe("thread start commands", () => {
  it("publishes newly started threads before the first turn completes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const started = threadFixture("started");
    const optimistic = { ...started, preview: "first prompt" };
    const recordStartedThread = vi.fn();

    const commands = createThreadStartCommand({
      stateStore,
      effects: {
        startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(started, { canAcceptDirectInput: false }))),
      },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread,
    });

    await commands.startThread("first prompt");

    expect(stateStore.getState()).not.toHaveProperty("threadList");
    expect(recordStartedThread).toHaveBeenCalledWith(optimistic);
    expect(activeThreadState(stateStore.getState())?.canAcceptDirectInput).toBe(false);
  });

  it("identifies the created target before activating it", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const adoptPanelTarget = vi.fn((threadId: string | null) => {
      expect(threadId).toBe("started");
      expect(activeThreadId(stateStore.getState())).toBeNull();
    });
    const commands = createThreadStartCommand({
      stateStore,
      effects: {
        startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started")))),
      },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread: vi.fn(),
    });

    await commands.startThread("first prompt", { adoptPanelTarget });

    expect(adoptPanelTarget).toHaveBeenCalledOnce();
    expect(activeThreadId(stateStore.getState())).toBe("started");
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

    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread: vi.fn(),
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

  it("retargets an explicitly preserved pending submission to the newly started thread", async () => {
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
    const commands = createThreadStartCommand({
      stateStore,
      effects: {
        startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started")))),
      },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread: vi.fn(),
    });

    await commands.startThread(pending.text, { preservePendingSubmissionId: pending.id });

    expect(stateStore.getState().pendingSubmission).toMatchObject({ id: pending.id, targetThreadId: "started" });
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
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread: vi.fn(() => started.promise) },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread,
    });

    const starting = commands.startThread(pending.text, { preservePendingSubmissionId: pending.id });
    stateStore.dispatch(resumedThreadAction({ response: activationFixture(threadFixture("selected")) }));
    started.resolve(completedActivation(activationFixture(threadFixture("delayed"))));

    await expect(starting).resolves.toEqual({ kind: "created-not-activated" });
    expect(activeThreadId(stateStore.getState())).toBe("selected");
    expect(recordStartedThread).toHaveBeenCalledWith(threadFixture("delayed", { preview: pending.text }));
  });

  it("starts threads with service tier from explicit effective config", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const shared = chatSharedResourcesFixture({ runtimeConfig: { ...runtimeConfigFixture(), serviceTier: "flex" } });
    const startThread = vi
      .fn()
      .mockResolvedValue(completedActivation(activationFixture(threadFixture("started"), { serviceTier: "flex" })));
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForShared(shared),
      recordStartedThread: vi.fn(),
    });

    await commands.startThread();

    expect(startThread).toHaveBeenCalledWith({ serviceTier: "flex" });
  });

  it("starts threads with permission profile from explicit config", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const shared = chatSharedResourcesFixture({
      runtimeConfig: {
        ...runtimeConfigFixture(),
        startupPermissions: {
          ...runtimeConfigFixture().startupPermissions,
          activePermissionProfile: { id: ":workspace", extends: null },
        },
      },
    });
    const startThread = vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started"))));
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForShared(shared),
      recordStartedThread: vi.fn(),
    });

    await commands.startThread();

    expect(startThread).toHaveBeenCalledWith({ permissions: ":workspace" });
  });

  it("keeps app-server preview when newly started threads already have one", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const started = threadFixture("started", { preview: "server preview" });
    const recordStartedThread = vi.fn();
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(started))) },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread,
    });

    await commands.startThread("local preview");

    expect(recordStartedThread).toHaveBeenCalledWith(started);
  });

  it("does not apply newly started threads after the port returns no activation", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const recordStartedThread = vi.fn();
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread: vi.fn().mockResolvedValue({ kind: "not-started" }) },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread,
    });

    await expect(commands.startThread("local preview")).resolves.toEqual({ kind: "not-started" });
    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(stateStore.getState()).not.toHaveProperty("threadList");
    expect(recordStartedThread).not.toHaveBeenCalled();
  });
});

const runtimeSnapshotForTestState = runtimeSnapshotForShared(chatSharedResourcesFixture());

function runtimeSnapshotForShared(shared: ChatSharedDisplayValues) {
  return (state: Parameters<typeof runtimeSnapshotForChatState>[0]) =>
    runtimeSnapshotForChatState(state, {
      runtimeConfigSnapshot: () => shared.runtimeConfig,
      rateLimitsSnapshot: () => shared.rateLimit,
      modelsSnapshot: () => shared.availableModels,
    });
}

function threadFixture(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    preview: "",
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: 0,
    updatedAt: 0,
    recencyAt: null,
    ...overrides,
  };
}

function activationFixture(thread: Thread, overrides: Partial<ThreadActivationSnapshot> = {}): ThreadActivationSnapshot {
  return {
    thread,
    canAcceptDirectInput: null,
    model: "gpt-5",
    serviceTier: null,
    approvalsReviewer: null,
    reasoningEffort: null,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    approvalPolicyKnown: false,
    sandboxPolicyKnown: false,
    permissionProfileKnown: false,
    ...overrides,
  };
}

function completedActivation(value: ThreadActivationSnapshot): EffectOutcome<ThreadActivationSnapshot> {
  return { kind: "completed", value };
}
