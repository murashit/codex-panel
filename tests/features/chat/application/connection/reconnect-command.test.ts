import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import {
  type ChatReconnectCommandHost,
  createReconnectPanelCommand,
} from "../../../../../src/features/chat/application/connection/reconnect-command";
import { activeThreadId, createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ActiveThreadResumedAction } from "../../../../../src/features/chat/application/state/transition-actions";
import { deferred } from "../../../../support/async";

function createHost(overrides: Partial<ChatReconnectCommandHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  stateStore.dispatch({ type: "ui/panel-set", panel: "history" });
  resumeActiveThread(stateStore);
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
    cleanupForConnectionReset: vi.fn().mockResolvedValue(undefined),
    resetConnectionScope: vi.fn(),
    setStatus: vi.fn(),
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => true),
    resumeThread: vi.fn(async (threadId: string) => {
      resumeActiveThread(stateStore, { thread: threadFixture({ id: threadId }) });
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
    expect(host.cleanupForConnectionReset).toHaveBeenCalledOnce();
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
    resumeActiveThread(stateStore, { thread, lifetime: { kind: "persistent" } });
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
    resumeSideThread(stateStore);

    await reconnect({ beforeTargetReset });

    expect(host.resumeThread).not.toHaveBeenCalled();
    expect(host.cleanupForConnectionReset).toHaveBeenCalledOnce();
    expect(beforeTargetReset).toHaveBeenCalledOnce();
    expect(stateStore.getState().panelThread).toEqual({ kind: "empty" });
    expect(vi.mocked(host.cleanupForConnectionReset).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(host.resetConnectionScope).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps an ephemeral target intact until its connection cleanup settles", async () => {
    const cleanup = deferred<void>();
    const { host, stateStore, reconnect } = createHost({
      cleanupForConnectionReset: vi.fn(() => cleanup.promise),
    });
    resumeSideThread(stateStore);

    const operation = reconnect();
    await Promise.resolve();

    expect(activeThreadId(stateStore.getState())).toBe("side-thread");
    expect(host.resetConnectionScope).not.toHaveBeenCalled();

    cleanup.resolve(undefined);
    await expect(operation).resolves.toBe(false);

    expect(stateStore.getState().panelThread).toEqual({ kind: "empty" });
    expect(host.resetConnectionScope).toHaveBeenCalledOnce();
  });

  it("does not reset a newer target after ephemeral cleanup settles", async () => {
    const cleanup = deferred<void>();
    const { host, stateStore, reconnect } = createHost({
      cleanupForConnectionReset: vi.fn(() => cleanup.promise),
    });
    const beforeTargetReset = vi.fn();
    resumeSideThread(stateStore);

    const operation = reconnect({ beforeTargetReset });
    stateStore.dispatch({ type: "active-thread/cleared" });
    cleanup.resolve(undefined);

    await expect(operation).resolves.toBe(false);
    expect(beforeTargetReset).not.toHaveBeenCalled();
    expect(host.resetConnectionScope).not.toHaveBeenCalled();
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

    await vi.waitFor(() => expect(host.ensureConnected).toHaveBeenCalledOnce());
    expect(host.resetConnectionScope).toHaveBeenCalledOnce();

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
    await vi.waitFor(() => expect(host.ensureConnected).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "active-thread/cleared" });
    finishConnecting();

    await expect(operation).resolves.toBe(false);
    expect(host.resumeThread).not.toHaveBeenCalled();
  });
});

function resumeActiveThread(
  stateStore: ReturnType<typeof createChatStateStore>,
  options: { thread?: Thread; lifetime?: ActiveThreadResumedAction["lifetime"] } = {},
): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    canAcceptDirectInput: null,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: options.thread ?? threadFixture(),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    ...(options.lifetime ? { lifetime: options.lifetime } : {}),
  });
}

function resumeSideThread(stateStore: ReturnType<typeof createChatStateStore>): void {
  resumeActiveThread(stateStore, {
    thread: threadFixture({ id: "side-thread", preview: "Side chat" }),
    lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
  });
}

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread",
    preview: "",
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}
