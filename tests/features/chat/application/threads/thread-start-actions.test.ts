import { describe, expect, it, vi } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/actions";
import { activeThreadId } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createThreadStartActions } from "../../../../../src/features/chat/application/threads/thread-start-actions";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/turns/web-submission";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import { deferred } from "../../../../support/async";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("thread start actions", () => {
  it("publishes newly started threads before the first turn completes", async () => {
    let state = chatStateFixture();
    const existing = threadFixture("existing");
    state = chatStateWith(state, { threadList: { listedThreads: [existing] } });
    const stateStore = createChatStateStore(state);
    const started = threadFixture("started");
    const optimistic = { ...started, preview: "first prompt" };
    const recordStartedThread = vi.fn();
    const syncThreadGoal = vi.fn();

    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: { startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(started))) },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread,
      syncThreadGoal,
    });

    await actions.startThread("first prompt");

    expect(stateStore.getState().threadList.listedThreads).toEqual([optimistic, existing]);
    expect(recordStartedThread).toHaveBeenCalledWith(optimistic);
    expect(syncThreadGoal).toHaveBeenCalledWith("started");
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

    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await actions.startThread("first prompt");

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
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: {
        startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started")))),
      },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread: vi.fn(),
      syncThreadGoal,
    });

    await actions.startThread("first goal", { syncGoal: false });

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
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: {
        startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(threadFixture("started")))),
      },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await actions.startThread(pending.text, { preservePendingSubmissionId: pending.id });

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
        originalDraft: "/web https://example.com",
        phase: "cancellable",
      },
    });
    const started = deferred<EffectOutcome<ThreadActivationSnapshot>>();
    const recordStartedThread = vi.fn();
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: { startThread: vi.fn(() => started.promise) },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread,
      syncThreadGoal: vi.fn(),
    });

    const starting = actions.startThread(pending.text, { preservePendingSubmissionId: pending.id });
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
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await actions.startThread();

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
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: { startThread },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await actions.startThread();

    expect(startThread).toHaveBeenCalledWith({ permissions: ":workspace" });
  });

  it("keeps app-server preview when newly started threads already have one", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const started = threadFixture("started", { preview: "server preview" });
    const recordStartedThread = vi.fn();
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: { startThread: vi.fn().mockResolvedValue(completedActivation(activationFixture(started))) },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread,
      syncThreadGoal: vi.fn(),
    });

    await actions.startThread("local preview");

    expect(recordStartedThread).toHaveBeenCalledWith(started);
  });

  it("does not apply newly started threads after the transport returns no activation", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const recordStartedThread = vi.fn();
    const syncThreadGoal = vi.fn();
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: { startThread: vi.fn().mockResolvedValue({ kind: "not-started" }) },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread,
      syncThreadGoal,
    });

    await expect(actions.startThread("local preview")).resolves.toEqual({ kind: "not-started" });
    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(stateStore.getState().threadList.listedThreads).toEqual([]);
    expect(recordStartedThread).not.toHaveBeenCalled();
    expect(syncThreadGoal).not.toHaveBeenCalled();
  });

  it("records a thread that was created before its app-server context became stale", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const created = activationFixture(threadFixture("created"));
    const recordStartedThread = vi.fn();
    const actions = createThreadStartActions({
      stateStore,
      threadStartTransport: {
        startThread: vi.fn().mockResolvedValue({ kind: "completed-stale", value: created }),
      },
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordStartedThread,
      syncThreadGoal: vi.fn(),
    });

    await expect(actions.startThread("draft preview")).resolves.toEqual({
      kind: "created-not-activated",
      threadId: "created",
    });

    expect(recordStartedThread).toHaveBeenCalledWith(threadFixture("created", { preview: "draft preview" }));
    expect(activeThreadId(stateStore.getState())).toBeNull();
  });
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
