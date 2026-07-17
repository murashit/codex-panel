import { describe, expect, it, vi } from "vitest";

import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { EphemeralThreadLifecycle } from "../../../../../src/features/chat/application/threads/ephemeral-thread-lifecycle";
import {
  createPersistentNavigationLifecycle,
  type PersistentNavigationLifecycle,
} from "../../../../../src/features/chat/application/threads/persistent-navigation-lifecycle";
import type { ThreadSubscriptionTransport } from "../../../../../src/features/chat/application/threads/thread-subscription-transport";

describe("persistent navigation lifecycle", () => {
  it("unsubscribes a running persistent subagent only after the target resume becomes active", async () => {
    const store = runningSubagentStore();
    const subscriptions = subscriptionTransport();
    const ephemeral = ephemeralLifecycle();
    const lifecycle = createLifecycle({ stateStore: store, subscriptions, ephemeral });

    const preparation = await lifecycle.prepareForPersistentNavigation("other");

    expect(preparation).toEqual({ kind: "unsubscribe-after-resume", threadId: "child", targetThreadId: "other" });
    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
    expect(ephemeral.prepareForPersistentNavigation).not.toHaveBeenCalled();
    expect(store.getState().panelThread).toMatchObject({ kind: "active", thread: { id: "child" } });
    resumeInteractiveThread(store, "other");

    if (!preparation) throw new Error("Expected navigation preparation.");
    await lifecycle.completePersistentNavigation(preparation);

    expect(subscriptions.unsubscribeThread).toHaveBeenCalledWith("child");
  });

  it("keeps the subagent subscribed when target resume does not replace it", async () => {
    const store = runningSubagentStore();
    const subscriptions = subscriptionTransport();
    const lifecycle = createLifecycle({ stateStore: store, subscriptions });

    const preparation = await lifecycle.prepareForPersistentNavigation("other");
    if (!preparation) throw new Error("Expected navigation preparation.");
    await lifecycle.completePersistentNavigation(preparation);

    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
    expect(store.getState().panelThread).toMatchObject({ kind: "active", thread: { id: "child" } });
  });

  it("blocks clearing a running subagent when pre-unsubscribe fails", async () => {
    const store = runningSubagentStore();
    const subscriptions = subscriptionTransport();
    vi.mocked(subscriptions.unsubscribeThread).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const addSystemMessage = vi.fn();
    const lifecycle = createLifecycle({ stateStore: store, subscriptions, addSystemMessage });

    await expect(lifecycle.prepareForPersistentNavigation(null)).resolves.toBeNull();

    expect(store.getState().panelThread).toMatchObject({ kind: "active", thread: { id: "child" } });
    expect(addSystemMessage).toHaveBeenCalledWith("Could not leave the running subagent. Try again before navigating.");
  });

  it("does not unsubscribe when the target is the already active subagent", async () => {
    const subscriptions = subscriptionTransport();
    const lifecycle = createLifecycle({ stateStore: runningSubagentStore(), subscriptions });

    await expect(lifecycle.prepareForPersistentNavigation("child")).resolves.toEqual({ kind: "ready" });

    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
  });
});

function runningSubagentStore() {
  const store = createChatStateStore();
  store.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: {
      id: "child",
      cliVersion: "test",
      provenance: {
        kind: "subagent",
        subagentKind: "thread-spawn",
        parentThreadId: "parent",
        sessionId: "session",
        depth: 1,
        agentNickname: "Scout",
        agentRole: "explorer",
      },
    } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
  store.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });
  return store;
}

function resumeInteractiveThread(store: ReturnType<typeof createChatStateStore>, threadId: string): void {
  store.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: { id: threadId, cliVersion: "test", provenance: { kind: "interactive" } } as never,
    cwd: "/vault",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function createLifecycle(options: {
  stateStore: ReturnType<typeof createChatStateStore>;
  subscriptions: ThreadSubscriptionTransport;
  ephemeral?: EphemeralThreadLifecycle;
  addSystemMessage?: (text: string) => void;
}): PersistentNavigationLifecycle {
  return createPersistentNavigationLifecycle({
    stateStore: options.stateStore,
    subscriptions: options.subscriptions,
    ephemeral: options.ephemeral ?? ephemeralLifecycle(),
    addSystemMessage: options.addSystemMessage ?? vi.fn(),
  });
}

function subscriptionTransport(result = true): ThreadSubscriptionTransport {
  return { unsubscribeThread: vi.fn().mockResolvedValue(result) };
}

function ephemeralLifecycle(): EphemeralThreadLifecycle {
  return {
    open: vi.fn(),
    prepareForPersistentNavigation: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}
