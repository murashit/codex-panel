import { describe, expect, it, vi } from "vitest";
import { type ChatReconnectActionsHost, reconnectPanel } from "../../../../../src/features/chat/application/connection/reconnect-actions";
import { activeThreadId, createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";

function createHost(overrides: Partial<ChatReconnectActionsHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: { id: "thread" } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
  stateStore.dispatch({
    type: "request/user-input-queued",
    input: {
      requestId: 7,
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "input",
        questions: [],
        autoResolutionMs: null,
      },
    },
  });
  stateStore.dispatch({ type: "thread-list/applied", threads: [{ id: "thread" } as never] });
  const host: ChatReconnectActionsHost = {
    stateStore,
    invalidateConnectionWork: vi.fn(),
    invalidateThreadWork: vi.fn(),
    clearDeferredDiagnostics: vi.fn(),
    resetConnection: vi.fn(),
    setStatus: vi.fn(),
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => true),
    resumeThread: vi.fn(async (threadId: string) => {
      stateStore.dispatch({
        type: "active-thread/resumed",
        approvalPolicyKnown: true,
        sandboxPolicyKnown: true,
        permissionProfileKnown: true,
        approvalPolicy: null,
        sandboxPolicy: null,
        activePermissionProfile: null,
        thread: { id: threadId } as never,
        cwd: "/vault",
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        approvalsReviewer: null,
      });
    }),
    addSystemMessage: vi.fn(),
    ...overrides,
  };
  return { host, stateStore };
}

describe("reconnectPanel", () => {
  it("resets local connection work before reconnecting and retains shared thread projections", async () => {
    const { host, stateStore } = createHost();

    await expect(reconnectPanel(host)).resolves.toBe(true);

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.invalidateConnectionWork).toHaveBeenCalledOnce();
    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(host.clearDeferredDiagnostics).toHaveBeenCalledOnce();
    expect(host.resetConnection).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Reconnecting...", { kind: "connecting" });
    expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
    expect(stateStore.getState().threadList).toEqual({ listedThreads: [{ id: "thread" }] });
    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
  });

  it.each([
    {
      label: "persistent",
      thread: {
        id: "persistent-thread",
        preview: "Persistent preview",
        name: "Persistent title",
        archived: false,
        createdAt: 1,
        updatedAt: 1,
        provenance: { kind: "interactive" },
      },
    },
    {
      label: "subagent",
      thread: {
        id: "subagent-thread",
        preview: "Subagent preview",
        name: "Subagent title",
        archived: false,
        createdAt: 1,
        updatedAt: 1,
        provenance: {
          kind: "subagent",
          subagentKind: "review",
          parentThreadId: "parent-thread",
          sessionId: "session",
          depth: 1,
          agentNickname: "reviewer",
          agentRole: "review",
        },
      },
    },
  ] as const)("resumes the same $label thread after an unexpected exit", async ({ thread }) => {
    const { host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread,
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
      lifetime: { kind: "persistent" },
    });
    stateStore.dispatch({ type: "connection/scoped-cleared" });
    expect(stateStore.getState().panelThread).toEqual({
      kind: "awaiting-resume",
      threadId: thread.id,
      fallbackTitle: thread.name,
    });

    await expect(reconnectPanel(host)).resolves.toBe(true);

    expect(host.resumeThread).toHaveBeenCalledWith(thread.id);
    expect(activeThreadId(stateStore.getState())).toBe(thread.id);
  });

  it("does not resume an ephemeral thread after an unexpected exit", async () => {
    const { host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: { id: "side-thread", preview: "Side chat", name: null } as never,
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });
    stateStore.dispatch({ type: "connection/scoped-cleared" });
    expect(stateStore.getState().panelThread).toEqual({ kind: "empty" });

    await reconnectPanel(host);

    expect(host.resumeThread).not.toHaveBeenCalled();
  });

  it("reports resume failures after reconnecting", async () => {
    const { host } = createHost({
      resumeThread: vi.fn().mockRejectedValue(new Error("resume failed")),
    });

    await reconnectPanel(host);

    expect(host.addSystemMessage).toHaveBeenCalledWith("resume failed");
  });
});
