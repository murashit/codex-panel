import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import { activeThreadId, createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
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
  it("clears active thread identity as a complete archive transaction", () => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    sync.applyThreadArchiveToActiveIdentity("thread");

    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("ignores archive notifications for non-active threads without identity side effects", () => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("active"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    sync.applyThreadArchiveToActiveIdentity("other");

    expect(activeThreadId(stateStore.getState())).toBe("active");
    expect(host.invalidateThreadWork).not.toHaveBeenCalled();
    expect(host.resetThreadTurnPresence).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
  });

  it("clears pending restored thread identity when that thread is archived", () => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: "Restored" });

    sync.applyThreadArchiveToActiveIdentity("thread");

    expect(activeThreadId(stateStore.getState())).toBeNull();
    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(stateStore.getState().panelThread.kind).toBe("empty");
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("routes active thread rename notifications through active identity refresh", () => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread", "Old"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    sync.applyThreadRenameToActiveIdentity("thread", "New");

    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("routes pending restored thread rename notifications through active identity refresh", () => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: "Old" });

    sync.applyThreadRenameToActiveIdentity("thread", "New");

    expect(stateStore.getState().panelThread).toEqual({
      kind: "awaiting-resume",
      threadId: "thread",
      fallbackTitle: "New",
      provenance: null,
    });
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("ignores rename notifications for inactive and unrestored threads without identity side effects", () => {
    const { sync, host, stateStore } = createIdentitySyncHarness();
    stateStore.dispatch({ type: "thread-list/applied", threads: [thread("thread", "Old")] });

    sync.applyThreadRenameToActiveIdentity("other", "New");

    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Old");
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
  });
});
