import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createActiveThreadIdentitySync } from "../../../../../src/features/chat/application/threads/active-thread-identity-sync";
import type { RestorationController } from "../../../../../src/features/chat/application/threads/restoration-controller";
import type { RestoredThreadPlaceholderState } from "../../../../../src/features/chat/application/threads/restored-thread-lifecycle";

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

function createIdentitySyncHarness(options: { restoredThreadPending?: boolean } = {}) {
  const stateStore = createChatStateStore(createChatState());
  const restoredPlaceholder = vi.fn<() => RestoredThreadPlaceholderState | null>(() => null);
  const restoredClear = vi.fn();
  const restoredRename = vi.fn();
  const restoration = {
    clear: restoredClear,
    isPending: vi.fn(() => options.restoredThreadPending ?? false),
    placeholder: restoredPlaceholder,
    rename: restoredRename,
  } as unknown as RestorationController;
  const host = {
    stateStore,
    restoration,
    invalidateThreadWork: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    refreshTabHeader: vi.fn(),
  };
  return { sync: createActiveThreadIdentitySync(host), host, restoredClear, restoredPlaceholder, restoredRename, stateStore };
}

describe("createActiveThreadIdentitySync", () => {
  it("clears active thread identity as a complete archive transaction", () => {
    const { sync, host, restoredClear, stateStore } = createIdentitySyncHarness();
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

    expect(stateStore.getState().activeThread.id).toBeNull();
    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(restoredClear).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.refreshTabHeader).not.toHaveBeenCalled();
  });

  it("ignores archive notifications for non-active threads without identity side effects", () => {
    const { sync, host, restoredClear, stateStore } = createIdentitySyncHarness();
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

    expect(stateStore.getState().activeThread.id).toBe("active");
    expect(host.invalidateThreadWork).not.toHaveBeenCalled();
    expect(restoredClear).not.toHaveBeenCalled();
    expect(host.resetThreadTurnPresence).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
    expect(host.refreshTabHeader).not.toHaveBeenCalled();
  });

  it("clears pending restored thread identity when that thread is archived", () => {
    const { sync, host, restoredClear, stateStore } = createIdentitySyncHarness({ restoredThreadPending: true });

    sync.applyThreadArchiveToActiveIdentity("thread");

    expect(stateStore.getState().activeThread.id).toBeNull();
    expect(host.invalidateThreadWork).toHaveBeenCalledOnce();
    expect(restoredClear).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.refreshTabHeader).not.toHaveBeenCalled();
  });

  it("routes active thread rename notifications through active identity refresh", () => {
    const { sync, host, restoredRename, stateStore } = createIdentitySyncHarness();
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
    expect(host.refreshTabHeader).not.toHaveBeenCalled();
    expect(restoredRename).not.toHaveBeenCalled();
  });

  it("routes pending restored thread rename notifications through active identity refresh", () => {
    const { sync, host, restoredPlaceholder, restoredRename } = createIdentitySyncHarness({ restoredThreadPending: true });
    restoredPlaceholder.mockReturnValue({
      kind: "placeholder",
      threadId: "thread",
      title: "Old",
      explicitName: "Old",
      loading: null,
    });

    sync.applyThreadRenameToActiveIdentity("thread", "New");

    expect(restoredRename).toHaveBeenCalledWith("thread", "New");
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.refreshTabHeader).not.toHaveBeenCalled();
  });

  it("ignores rename notifications for inactive and unrestored threads without identity side effects", () => {
    const { sync, host, restoredPlaceholder, restoredRename, stateStore } = createIdentitySyncHarness();
    stateStore.dispatch({ type: "thread-list/applied", threads: [thread("thread", "Old")] });

    sync.applyThreadRenameToActiveIdentity("other", "New");

    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Old");
    expect(restoredPlaceholder).toHaveBeenCalledOnce();
    expect(restoredRename).not.toHaveBeenCalled();
    expect(host.refreshTabHeader).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
  });
});
