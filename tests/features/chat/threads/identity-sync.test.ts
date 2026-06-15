import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createIdentitySync } from "../../../../src/features/chat/application/threads/identity-sync";
import type { RestorationController } from "../../../../src/features/chat/application/threads/restoration-controller";
import type { RestoredThreadPlaceholderState } from "../../../../src/features/chat/application/lifecycle";
import type { Thread } from "../../../../src/domain/threads/model";

function thread(id: string, name: string | null = null): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name,
    archived: false,
  };
}

function createController() {
  const stateStore = createChatStateStore(createChatState());
  const restoredPlaceholder = vi.fn<() => RestoredThreadPlaceholderState | null>(() => null);
  const restoredRename = vi.fn();
  const restoration = {
    clear: vi.fn(),
    isPending: vi.fn(() => false),
    placeholder: restoredPlaceholder,
    rename: restoredRename,
  } as unknown as RestorationController;
  const host = {
    stateStore,
    restoration,
    invalidateResumeWork: vi.fn(),
    clearDeferredRestoredThreadHydration: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    refreshTabHeader: vi.fn(),
    refreshLiveState: vi.fn(),
  };
  return { controller: createIdentitySync(host), host, restoredPlaceholder, restoredRename, stateStore };
}

describe("createIdentitySync", () => {
  it("clears the active thread when it is archived", () => {
    const { controller, host, stateStore } = createController();
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    controller.applyThreadArchived("thread");

    expect(stateStore.getState().activeThread.id).toBeNull();
    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
  });

  it("updates restored thread titles on rename notifications", () => {
    const { controller, restoredPlaceholder, restoredRename, stateStore } = createController();
    stateStore.dispatch({ type: "thread-list/applied", threads: [thread("thread", "Old")] });
    restoredPlaceholder.mockReturnValue({
      kind: "placeholder",
      threadId: "thread",
      title: "Old",
      explicitName: "Old",
      loading: null,
    });

    controller.applyThreadRenamed("thread", "New");

    expect(stateStore.getState().threadList.listedThreads[0]?.name).toBe("Old");
    expect(restoredRename).toHaveBeenCalledWith("thread", "New");
  });
});
