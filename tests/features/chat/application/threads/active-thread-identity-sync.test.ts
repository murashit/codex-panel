import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import { activeThreadId, createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createActiveThreadIdentitySync } from "../../../../../src/features/chat/application/threads/active-thread-identity-sync";

function thread(id: string, name: string | null = null): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name,
    archived: false,
    provenance: { kind: "interactive" },
  };
}

function createIdentitySyncHarness() {
  const stateStore = createChatStateStore(createChatState());
  const host = {
    stateStore,
    invalidateThreadWork: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
  };
  return { sync: createActiveThreadIdentitySync(host), host, stateStore };
}

describe("createActiveThreadIdentitySync", () => {
  it.each(["active", "awaiting-resume"] as const)("clears an %s thread identity as a complete archive transaction", (phase) => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    if (phase === "active") activateThread(stateStore);
    else stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: "Restored" });

    sync.applyThreadUnavailableToActiveIdentity("thread");

    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(stateStore.getState().panelThread.kind).toBe("empty");
    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("ignores unavailable and rename notifications for unrelated threads", () => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    activateThread(stateStore, "active");

    sync.applyThreadUnavailableToActiveIdentity("other");
    sync.applyThreadRenameToActiveIdentity("other", "New");

    expect(activeThreadId(stateStore.getState())).toBe("active");
    expect(host.invalidateThreadWork).not.toHaveBeenCalled();
    expect(host.resetThreadTurnPresence).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
  });

  it.each(["active", "awaiting-resume"] as const)("routes %s thread renames through active identity refresh", (phase) => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    if (phase === "active") activateThread(stateStore, "thread", "Old");
    else stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: "Old" });

    sync.applyThreadRenameToActiveIdentity("thread", "New");

    const panelThread = stateStore.getState().panelThread;
    if (panelThread.kind === "awaiting-resume") {
      expect(panelThread).toEqual({
        kind: "awaiting-resume",
        threadId: "thread",
        fallbackTitle: "New",
        provenance: null,
      });
    }
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });
});

function activateThread(stateStore: ReturnType<typeof createChatStateStore>, id = "thread", name: string | null = null): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    canAcceptDirectInput: null,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: thread(id, name),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}
