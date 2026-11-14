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
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";

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
    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(host.resumeThread).toHaveBeenCalledWith("thread");
  });

  it.each([
    {
      label: "persistent",
      thread: panelThreadFixture({
        id: "persistent-thread",
        preview: "Persistent preview",
        name: "Persistent title",
        provenance: { kind: "interactive" },
      }),
    },
    {
      label: "subagent",
      thread: panelThreadFixture({
        id: "subagent-thread",
        preview: "Subagent preview",
        name: "Subagent title",
        provenance: {
          kind: "subagent",
          parentThreadId: "parent-thread",
        },
      }),
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

    const beforeTargetReset = vi.fn();
    await expect(reconnect({ beforeTargetReset })).resolves.toBe(true);

    expect(beforeTargetReset).not.toHaveBeenCalled();
    expect(host.resumeThread).toHaveBeenCalledWith(thread.id);
    expect(activeThreadId(stateStore.getState())).toBe(thread.id);
  });

  it("does not resume an ephemeral thread after an unexpected exit", async () => {
    const { host, stateStore, reconnect } = createHost();
    const beforeTargetReset = vi.fn();
    resumeSideThread(stateStore);

    await reconnect({ beforeTargetReset });

    expect(host.resumeThread).not.toHaveBeenCalled();
    expect(beforeTargetReset).toHaveBeenCalledOnce();
    expect(stateStore.getState().panelThread).toEqual({ kind: "empty" });
  });

  it("reports resume failures after reconnecting", async () => {
    const { host, reconnect } = createHost({
      resumeThread: vi.fn().mockRejectedValue(new Error("resume failed")),
    });

    await reconnect();

    expect(host.addSystemMessage).toHaveBeenCalledWith("resume failed");
  });

  it("coalesces overlapping manual reconnect requests", async () => {
    const connecting = deferred<void>();
    const { host, reconnect } = createHost({
      ensureConnected: vi.fn(() => connecting.promise),
    });

    const first = reconnect();
    const second = reconnect();

    await vi.waitFor(() => expect(host.ensureConnected).toHaveBeenCalledOnce());
    expect(host.resetConnectionScope).toHaveBeenCalledOnce();

    connecting.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(host.resumeThread).toHaveBeenCalledOnce();

    await expect(reconnect()).resolves.toBe(true);
    expect(host.resetConnectionScope).toHaveBeenCalledTimes(2);
    expect(host.ensureConnected).toHaveBeenCalledTimes(2);
    expect(host.resumeThread).toHaveBeenCalledTimes(2);
  });

  it("does not resume the old target after navigation while reconnecting", async () => {
    const connecting = deferred<void>();
    const { host, stateStore, reconnect } = createHost({
      ensureConnected: vi.fn(() => connecting.promise),
    });

    const operation = reconnect();
    await vi.waitFor(() => expect(host.ensureConnected).toHaveBeenCalledOnce());
    stateStore.dispatch({ type: "active-thread/cleared" });
    connecting.resolve();

    await expect(operation).resolves.toBe(false);
    expect(host.resumeThread).not.toHaveBeenCalled();
  });
});

function resumeActiveThread(
  stateStore: ReturnType<typeof createChatStateStore>,
  options: { thread?: Thread; lifetime?: ActiveThreadResumedAction["lifetime"] } = {},
): void {
  stateStore.dispatch({
    ...threadActivationFixture(options.thread ?? threadFixture()),
    type: "active-thread/resumed",
    ...(options.lifetime ? { lifetime: options.lifetime } : {}),
  });
}

function resumeSideThread(stateStore: ReturnType<typeof createChatStateStore>): void {
  resumeActiveThread(stateStore, {
    thread: threadFixture({ id: "side-thread", preview: "Side chat" }),
    lifetime: { kind: "ephemeral", mode: "side-chat", sourceThreadId: "source", sourceThreadTitle: "Source" },
  });
}

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return panelThreadFixture({
    id: "thread",
    ...overrides,
  });
}
