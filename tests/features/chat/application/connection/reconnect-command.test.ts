import { describe, expect, it, vi } from "vitest";
import {
  type ChatReconnectCommandHost,
  createReconnectPanelCommand,
} from "../../../../../src/features/chat/application/connection/reconnect-command";
import { activeThreadId, createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";

function createHost(overrides: Partial<ChatReconnectCommandHost> = {}) {
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
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
  stateStore.dispatch({
    type: "request/user-input-queued",
    input: {
      requestId: 7,
      autoResolutionAtMs: null,
      params: {
        turnId: "turn",
        isBlocking: true,
        questions: [],
      },
    },
  });
  const host: ChatReconnectCommandHost = {
    stateStore,
    resetConnectionScope: vi.fn(),
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
        model: null,
        reasoningEffort: null,
        serviceTier: null,
        approvalsReviewer: null,
      });
      return {
        hydrate: vi.fn().mockResolvedValue(true),
      };
    }),
    addSystemMessage: vi.fn(),
    ...overrides,
  };
  return { host, stateStore, reconnect: createReconnectPanelCommand(host) };
}

describe("createReconnectPanelCommand", () => {
  it("resets local connection work before reconnecting without owning shared thread projections", async () => {
    const { host, stateStore, reconnect } = createHost();

    await expect(reconnect()).resolves.toBe(true);

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(host.resetConnectionScope).toHaveBeenCalledOnce();
    expect(host.setStatus).toHaveBeenCalledWith("Reconnecting...", { kind: "connecting" });
    expect(stateStore.getState().requests.pendingUserInputs).toEqual([]);
    expect(stateStore.getState()).not.toHaveProperty("threadList");
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
    const { host, stateStore, reconnect } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread,
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
      provenance: thread.provenance,
    });

    await expect(reconnect()).resolves.toBe(true);

    expect(host.resumeThread).toHaveBeenCalledWith(thread.id);
    expect(activeThreadId(stateStore.getState())).toBe(thread.id);
  });

  it("does not resume an ephemeral thread after an unexpected exit", async () => {
    const { host, stateStore, reconnect } = createHost();
    const beforeTargetReset = vi.fn();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: { id: "side-thread", preview: "Side chat", name: null } as never,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });

    await reconnect({ beforeTargetReset });

    expect(host.resumeThread).not.toHaveBeenCalled();
    expect(beforeTargetReset).toHaveBeenCalledOnce();
    expect(stateStore.getState().panelThread).toEqual({ kind: "empty" });
  });

  it("does not announce a target reset when reconnecting a persistent thread", async () => {
    const { reconnect } = createHost();
    const beforeTargetReset = vi.fn();

    await reconnect({ beforeTargetReset });

    expect(beforeTargetReset).not.toHaveBeenCalled();
  });

  it("reports resume failures after reconnecting", async () => {
    const { host, reconnect } = createHost({
      resumeThread: vi.fn().mockRejectedValue(new Error("resume failed")),
    });

    await reconnect();

    expect(host.addSystemMessage).toHaveBeenCalledWith("resume failed");
  });

  it("coalesces overlapping manual reconnect requests", async () => {
    let finishConnecting: () => void = () => undefined;
    const connecting = new Promise<void>((resolve) => {
      finishConnecting = resolve;
    });
    const { host, reconnect } = createHost({
      ensureConnected: vi.fn(() => connecting),
    });

    const first = reconnect();
    const second = reconnect();

    expect(host.resetConnectionScope).toHaveBeenCalledOnce();
    expect(host.ensureConnected).toHaveBeenCalledOnce();

    finishConnecting();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(host.resumeThread).toHaveBeenCalledOnce();
  });

  it("does not resume the old target after navigation while reconnecting", async () => {
    let finishConnecting: () => void = () => undefined;
    const connecting = new Promise<void>((resolve) => {
      finishConnecting = resolve;
    });
    const { host, stateStore, reconnect } = createHost({
      ensureConnected: vi.fn(() => connecting),
    });

    const operation = reconnect();
    stateStore.dispatch({ type: "active-thread/cleared" });
    finishConnecting();

    await expect(operation).resolves.toBe(false);
    expect(host.resumeThread).not.toHaveBeenCalled();
  });
});
