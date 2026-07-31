import { describe, expect, it, vi } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/actions";
import { activeThreadId } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/submission/web-submission";
import { createThreadStartCommand } from "../../../../../src/features/chat/application/threads/thread-start-command";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import { deferred } from "../../../../support/async";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { chatStateFixture, chatStateWith, sharedResourcesForChatState } from "../../support/state";

describe("thread start commands", () => {
  it("publishes newly started threads before the first turn completes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const started = threadFixture("started");
    const optimistic = { ...started, preview: "first prompt" };
    const recordStartedThread = vi.fn();
    const syncThreadGoal = vi.fn();

    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(started))) },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread,
      syncThreadGoal,
    });

    await commands.startThread("first prompt");

    expect(stateStore.getState()).not.toHaveProperty("threadList");
    expect(recordStartedThread).toHaveBeenCalledWith(optimistic);
    expect(syncThreadGoal).toHaveBeenCalledWith("started");
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
      syncThreadGoal: vi.fn(),
    });

    await commands.startThread("first prompt", { adoptPanelTarget });

    expect(adoptPanelTarget).toHaveBeenCalledOnce();
    expect(activeThreadId(stateStore.getState())).toBe("started");
  });

  it("keeps empty-panel runtime reservations when starting the first thread", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    stateStore.dispatch({ type: "runtime/model-requested", model: "gpt-5.5" });
    stateStore.dispatch({ type: "runtime/permission-profile-requested", permissionProfile: ":workspace" });
    stateStore.dispatch({ type: "runtime/reasoning-effort-requested", effort: "high" });
    stateStore.dispatch({ type: "runtime/fast-mode-requested", fastMode: "enabled" });
    stateStore.dispatch({ type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });
    stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });
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
      syncThreadGoal: vi.fn(),
    });

    await commands.startThread("first prompt");

    expect(startThread).toHaveBeenCalledWith({
      permissions: ":workspace",
      serviceTier: "fast",
    });
    expect(stateStore.getState().runtime.active.model).toBe("gpt-5");
    expect(stateStore.getState().runtime.pending.model).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(stateStore.getState().runtime.pending.permissionProfile).toEqual({ kind: "set", value: ":workspace" });
    expect(stateStore.getState().runtime.pending.reasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(stateStore.getState().runtime.pending.fastMode).toEqual({ kind: "set", value: "enabled" });
    expect(stateStore.getState().runtime.pending.approvalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(stateStore.getState().runtime.pending.collaborationMode).toEqual(setCollaborationModeIntent("plan"));
  });

  it("can skip newly started thread goal sync when the caller sets the first goal", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const syncThreadGoal = vi.fn();
    const commands = createThreadStartCommand({
      stateStore,
      effects: {
        startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started")))),
      },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread: vi.fn(),
      syncThreadGoal,
    });

    await commands.startThread("first goal", { syncGoal: false });

    expect(syncThreadGoal).not.toHaveBeenCalled();
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
      syncThreadGoal: vi.fn(),
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
      syncThreadGoal: vi.fn(),
    });

    const starting = commands.startThread(pending.text, { preservePendingSubmissionId: pending.id });
    stateStore.dispatch(resumedThreadAction({ response: activationFixture(threadFixture("selected")) }));
    started.resolve(completedActivation(activationFixture(threadFixture("delayed"))));

    await expect(starting).resolves.toEqual({ kind: "created-not-activated", threadId: "delayed" });
    expect(activeThreadId(stateStore.getState())).toBe("selected");
    expect(recordStartedThread).toHaveBeenCalledWith(threadFixture("delayed", { preview: pending.text }));
  });

  it("starts threads with service tier from explicit effective config", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { connection: { runtimeConfig: { ...runtimeConfigFixture(), serviceTier: "flex" } } });
    const stateStore = createChatStateStore(state);
    const startThread = vi
      .fn()
      .mockResolvedValue(completedActivation(activationFixture(threadFixture("started"), { serviceTier: "flex" })));
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await commands.startThread();

    expect(startThread).toHaveBeenCalledWith({ serviceTier: "flex" });
  });

  it("starts threads with permission profile from explicit config", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      connection: {
        runtimeConfig: {
          ...runtimeConfigFixture(),
          startupPermissions: {
            ...runtimeConfigFixture().startupPermissions,
            activePermissionProfile: { id: ":workspace", extends: null },
          },
        },
      },
    });
    const stateStore = createChatStateStore(state);
    const startThread = vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started"))));
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread: vi.fn(),
      syncThreadGoal: vi.fn(),
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
      syncThreadGoal: vi.fn(),
    });

    await commands.startThread("local preview");

    expect(recordStartedThread).toHaveBeenCalledWith(started);
  });

  it("does not apply newly started threads after the port returns no activation", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const recordStartedThread = vi.fn();
    const syncThreadGoal = vi.fn();
    const commands = createThreadStartCommand({
      stateStore,
      effects: { startThread: vi.fn().mockResolvedValue({ kind: "not-started" }) },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread,
      syncThreadGoal,
    });

    await expect(commands.startThread("local preview")).resolves.toEqual({ kind: "not-started" });
    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(stateStore.getState()).not.toHaveProperty("threadList");
    expect(recordStartedThread).not.toHaveBeenCalled();
    expect(syncThreadGoal).not.toHaveBeenCalled();
  });

  it("records a thread that was created before its app-server context became stale", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const created = activationFixture(threadFixture("created"));
    const recordStartedThread = vi.fn();
    const commands = createThreadStartCommand({
      stateStore,
      effects: {
        startThread: vi.fn().mockResolvedValue({ kind: "completed-stale", value: created }),
      },
      runtimeSnapshotForState: runtimeSnapshotForTestState,
      recordStartedThread,
      syncThreadGoal: vi.fn(),
    });

    await expect(commands.startThread("draft preview")).resolves.toEqual({
      kind: "created-not-activated",
      threadId: "created",
    });

    expect(recordStartedThread).toHaveBeenCalledWith(threadFixture("created", { preview: "draft preview" }));
    expect(activeThreadId(stateStore.getState())).toBeNull();
  });
});

const runtimeSnapshotForTestState = (state: Parameters<typeof runtimeSnapshotForChatState>[0]) =>
  runtimeSnapshotForChatState(state, {
    runtimeConfigSnapshot: () => sharedResourcesForChatState(state).runtimeConfig,
    rateLimitsSnapshot: () => sharedResourcesForChatState(state).rateLimit,
    modelsSnapshot: () => sharedResourcesForChatState(state).availableModels,
  });

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
  return { kind: "completed-current", value };
}
