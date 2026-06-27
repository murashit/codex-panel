import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createThreadManagementActions,
  type ThreadManagementActions,
  type ThreadManagementActionsHost,
} from "../../../../../src/features/chat/application/threads/thread-management-actions";
import type {
  ThreadMutationTransport,
  ThreadRollbackSnapshot,
} from "../../../../../src/features/chat/application/threads/thread-mutation-transport";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";
import { deferred, waitForAsyncWork } from "../../../../support/async";
import { chatStateMessageStreamItems, withChatStateMessageStreamItems } from "../../support/message-stream";
import { chatStateFixture } from "../../support/state";

interface ThreadMutationTransportMock {
  compactThread: Mock<ThreadMutationTransport["compactThread"]>;
  forkThread: Mock<ThreadMutationTransport["forkThread"]>;
  rollbackForkedThread: Mock<ThreadMutationTransport["rollbackForkedThread"]>;
  rollbackThread: Mock<ThreadMutationTransport["rollbackThread"]>;
}

interface ThreadOperationsMock {
  archiveThread: Mock<ThreadManagementActionsHost["operations"]["archiveThread"]>;
  renameThread: Mock<ThreadManagementActionsHost["operations"]["renameThread"]>;
}

type ThreadManagementActionsHostMock = Omit<
  ThreadManagementActionsHost,
  | "addSystemMessage"
  | "notifyActiveThreadIdentityChanged"
  | "openThreadInCurrentPanel"
  | "openThreadInNewView"
  | "operations"
  | "recordForkedThread"
  | "refreshAfterThreadMutation"
  | "setComposerText"
  | "setStatus"
  | "threadTransport"
> & {
  operations: ThreadOperationsMock;
  threadTransport: ThreadMutationTransportMock;
  addSystemMessage: Mock<ThreadManagementActionsHost["addSystemMessage"]>;
  setStatus: Mock<ThreadManagementActionsHost["setStatus"]>;
  setComposerText: Mock<ThreadManagementActionsHost["setComposerText"]>;
  openThreadInNewView: Mock<ThreadManagementActionsHost["openThreadInNewView"]>;
  openThreadInCurrentPanel: Mock<ThreadManagementActionsHost["openThreadInCurrentPanel"]>;
  notifyActiveThreadIdentityChanged: Mock<ThreadManagementActionsHost["notifyActiveThreadIdentityChanged"]>;
  refreshAfterThreadMutation: Mock<ThreadManagementActionsHost["refreshAfterThreadMutation"]>;
  recordForkedThread: Mock<ThreadManagementActionsHost["recordForkedThread"]>;
};

describe("thread management actions", () => {
  it("requests thread compaction and reports the shared status", async () => {
    const host = hostMock({ items: [] });
    const controller = threadManagementActions(host);

    await controller.compactThread("source");

    expect(host.threadTransport.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
  });

  it("reports compacting without an active thread", async () => {
    const host = hostMock({ items: [] });
    const controller = threadManagementActions(host);

    await controller.compactActiveThread();

    expect(host.addSystemMessage).toHaveBeenCalledWith("No active thread to compact.");
    expect(host.threadTransport.compactThread).not.toHaveBeenCalled();
  });

  it("does not report compaction completion after the panel switches threads", async () => {
    const compact = deferred<boolean>();
    const host = hostMock({ items: [] });
    host.threadTransport.compactThread.mockReturnValue(compact.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const controller = threadManagementActions(host);

    const pendingCompact = controller.compactThread("source");
    await waitForAsyncWork(() => {
      expect(host.threadTransport.compactThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("other"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    compact.resolve(true);
    await pendingCompact;

    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("does not report compaction completion when the transport rejects the mutation", async () => {
    const host = hostMock({
      items: [],
      threadTransport: {
        compactThread: vi.fn<ThreadMutationTransport["compactThread"]>().mockResolvedValue(false),
      },
    });
    const controller = threadManagementActions(host);

    await controller.compactThread("source");

    expect(host.threadTransport.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("delegates archive requests to thread operations", async () => {
    const host = hostMock({ items: [] });
    const controller = threadManagementActions(host);

    await controller.archiveThread("source", true);

    expect(host.operations.archiveThread).toHaveBeenCalledWith("source", { saveMarkdown: true });
    expect(host.addSystemMessage).not.toHaveBeenCalled();
  });

  it("reports archive operation failures", async () => {
    const host = hostMock({
      items: [],
      operations: {
        archiveThread: vi.fn<ThreadManagementActionsHost["operations"]["archiveThread"]>().mockRejectedValue(new Error("disk full")),
      },
    });
    const controller = threadManagementActions(host);

    await controller.archiveThread("source");

    expect(host.operations.archiveThread).toHaveBeenCalledWith("source", {});
    expect(host.addSystemMessage).toHaveBeenCalledWith("disk full");
  });

  it("forks from a selected turn by dropping later turns on the fork", async () => {
    const host = hostMock({ items: turnItems() });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-1", false);

    expect(host.threadTransport.forkThread).toHaveBeenCalledWith("source");
    expect(host.threadTransport.rollbackForkedThread).toHaveBeenCalledWith("forked", 2);
    expect(host.recordForkedThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "forked",
        name: "Rolled Back Thread",
        preview: "Post-rollback",
        updatedAt: 20,
      }),
    );
    expect(host.openThreadInNewView).toHaveBeenCalledWith("forked");
    expect(host.operations.archiveThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("archives the source before replacing the panel during fork and archive", async () => {
    const host = hostMock({ items: turnItems() });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.threadTransport.forkThread).toHaveBeenCalledWith("source");
    expect(host.operations.archiveThread).toHaveBeenCalledWith("source", {});
    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked");
    expect(callOrder(host.operations.archiveThread)).toBeLessThan(callOrder(host.openThreadInCurrentPanel));
  });

  it("keeps the source panel when fork and archive fails to archive", async () => {
    const host = hostMock({
      items: turnItems(),
      operations: {
        archiveThread: vi.fn<ThreadManagementActionsHost["operations"]["archiveThread"]>().mockRejectedValue(new Error("archive failed")),
      },
    });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.threadTransport.rollbackForkedThread).not.toHaveBeenCalled();
    expect(host.operations.archiveThread).toHaveBeenCalledWith("source", {});
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("archive failed");
  });

  it("keeps the source panel when fork and archive is declined by thread operations", async () => {
    const host = hostMock({
      items: turnItems(),
      operations: {
        archiveThread: vi.fn<ThreadManagementActionsHost["operations"]["archiveThread"]>().mockResolvedValue(false),
      },
    });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.operations.archiveThread).toHaveBeenCalledWith("source", {});
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("archive failed");
  });

  it("reports when fork and archive succeeds but the fork cannot replace the source panel", async () => {
    const host = hostMock({ items: turnItems() });
    host.openThreadInCurrentPanel.mockRejectedValue(new Error("resume failed"));
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(host.operations.archiveThread).toHaveBeenCalledWith("source", {});
    expect(host.addSystemMessage).toHaveBeenCalledWith("Archived thread source, but could not open forked thread forked: resume failed");
  });

  it("does not archive or replace the panel from stale fork responses", async () => {
    const fork = deferred<Thread | null>();
    const host = hostMock({ items: turnItems() });
    host.threadTransport.forkThread.mockReturnValue(fork.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-list/applied",
      threads: [{ ...panelThread("source"), name: "Source name" }],
      threadsLoaded: true,
    });
    const controller = threadManagementActions(host);

    const pendingFork = controller.forkThreadFromTurn("source", null, true);
    await waitForAsyncWork(() => {
      expect(host.threadTransport.forkThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("other"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    fork.resolve(panelThread("forked"));
    await pendingFork;

    expect(host.operations.archiveThread).not.toHaveBeenCalled();
    expect(host.operations.renameThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("does not open or record fork responses when the transport has no result", async () => {
    const host = hostMock({
      items: turnItems(),
      threadTransport: {
        forkThread: vi.fn<ThreadMutationTransport["forkThread"]>().mockResolvedValue(null),
      },
    });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", null, false);

    expect(host.recordForkedThread).not.toHaveBeenCalled();
    expect(host.openThreadInNewView).not.toHaveBeenCalled();
    expect(host.operations.archiveThread).not.toHaveBeenCalled();
  });

  it("delegates thread rename requests", async () => {
    const host = hostMock({ items: [] });
    const controller = threadManagementActions(host);

    await expect(controller.renameThread("thread", " Slash   command title ")).resolves.toBe(true);

    expect(host.operations.renameThread).toHaveBeenCalledWith("thread", " Slash   command title ");
  });

  it("returns false when thread operations reject a rename", async () => {
    const host = hostMock({
      items: [],
      operations: {
        renameThread: vi.fn<ThreadManagementActionsHost["operations"]["renameThread"]>().mockResolvedValue(false),
      },
    });
    const controller = threadManagementActions(host);

    await expect(controller.renameThread("thread", "   ")).resolves.toBe(false);

    expect(host.operations.renameThread).toHaveBeenCalledWith("thread", "   ");
  });

  it("applies rollback response items before refreshing shared thread state", async () => {
    const host = hostMock({ items: turnItems() });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "message-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadManagementActions(host);

    await controller.rollbackThread("source");

    expect(host.threadTransport.rollbackThread).toHaveBeenCalledWith("source");
    expect(chatStateMessageStreamItems(host.stateStore.getState()).slice(0, 2)).toMatchObject([
      { kind: "message", role: "user", text: "kept prompt", turnId: "kept-turn" },
      { kind: "message", role: "assistant", text: "kept answer", turnId: "kept-turn" },
    ]);
    expect(callOrder(host.setComposerText)).toBeLessThan(callOrder(host.addSystemMessage));
    expect(callOrder(host.addSystemMessage)).toBeLessThan(callOrder(host.refreshAfterThreadMutation));
  });

  it("ignores stale rollback responses after the panel switches threads", async () => {
    const rollback = deferred<ThreadRollbackSnapshot | null>();
    const host = hostMock({ items: turnItems() });
    host.threadTransport.rollbackThread.mockReturnValue(rollback.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "message-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadManagementActions(host);

    const pendingRollback = controller.rollbackThread("source");
    await waitForAsyncWork(() => {
      expect(host.threadTransport.rollbackThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("other"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    rollback.resolve(rollbackSnapshot());
    await pendingRollback;

    expect(host.stateStore.getState().activeThread.id).toBe("other");
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
    expect(host.refreshAfterThreadMutation).not.toHaveBeenCalled();
  });

  it("ignores rollback when the transport has no result", async () => {
    const host = hostMock({
      items: turnItems(),
      threadTransport: {
        rollbackThread: vi.fn<ThreadMutationTransport["rollbackThread"]>().mockResolvedValue(null),
      },
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "message-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadManagementActions(host);

    await controller.rollbackThread("source");

    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
    expect(host.refreshAfterThreadMutation).not.toHaveBeenCalled();
  });
});

function turnItems(): MessageStreamItem[] {
  return [
    { id: "u1", kind: "message", messageKind: "user", role: "user", text: "one", turnId: "turn-1" },
    {
      id: "a1",
      kind: "message",
      role: "assistant",
      text: "one answer",
      turnId: "turn-1",
      messageKind: "assistantResponse",
      messageState: "completed",
    },
    { id: "u2", kind: "message", messageKind: "user", role: "user", text: "two", turnId: "turn-2" },
    {
      id: "a2",
      kind: "message",
      role: "assistant",
      text: "two answer",
      turnId: "turn-2",
      messageKind: "assistantResponse",
      messageState: "completed",
    },
    { id: "u3", kind: "message", messageKind: "user", role: "user", text: "three", turnId: "turn-3" },
    {
      id: "a3",
      kind: "message",
      role: "assistant",
      text: "three answer",
      turnId: "turn-3",
      messageKind: "assistantResponse",
      messageState: "completed",
    },
  ];
}

function rollbackItems(): MessageStreamItem[] {
  return [
    { id: "kept-user", kind: "message", messageKind: "user", role: "user", text: "kept prompt", turnId: "kept-turn" },
    {
      id: "kept-agent",
      kind: "message",
      role: "assistant",
      text: "kept answer",
      turnId: "kept-turn",
      messageKind: "assistantResponse",
      messageState: "completed",
    },
  ];
}

function threadManagementActions(host: ThreadManagementActionsHost): ThreadManagementActions {
  return createThreadManagementActions(host);
}

function hostMock({
  items,
  operations: operationOverrides = {},
  threadTransport: transportOverrides = {},
}: {
  items: MessageStreamItem[];
  operations?: Partial<ThreadOperationsMock>;
  threadTransport?: Partial<ThreadMutationTransportMock>;
}): ThreadManagementActionsHostMock {
  const state = withChatStateMessageStreamItems(chatStateFixture(), items);
  const stateStore = createChatStateStore(state);
  const threadTransport: ThreadMutationTransportMock = {
    compactThread: vi.fn<ThreadMutationTransport["compactThread"]>().mockResolvedValue(true),
    forkThread: vi.fn<ThreadMutationTransport["forkThread"]>().mockResolvedValue(panelThread("forked")),
    rollbackForkedThread: vi.fn<ThreadMutationTransport["rollbackForkedThread"]>().mockResolvedValue(
      panelThread("forked", {
        name: "Rolled Back Thread",
        preview: "Post-rollback",
        updatedAt: 20,
      }),
    ),
    rollbackThread: vi.fn<ThreadMutationTransport["rollbackThread"]>().mockResolvedValue(rollbackSnapshot()),
    ...transportOverrides,
  };
  const operations: ThreadOperationsMock = {
    archiveThread: vi.fn<ThreadManagementActionsHost["operations"]["archiveThread"]>().mockResolvedValue(true),
    renameThread: vi.fn<ThreadManagementActionsHost["operations"]["renameThread"]>().mockResolvedValue(true),
    ...operationOverrides,
  };
  return {
    stateStore,
    threadTransport,
    operations,
    addSystemMessage: vi.fn<ThreadManagementActionsHost["addSystemMessage"]>(),
    setStatus: vi.fn<ThreadManagementActionsHost["setStatus"]>(),
    setComposerText: vi.fn<ThreadManagementActionsHost["setComposerText"]>(),
    openThreadInNewView: vi.fn<ThreadManagementActionsHost["openThreadInNewView"]>().mockResolvedValue(undefined),
    openThreadInCurrentPanel: vi.fn<ThreadManagementActionsHost["openThreadInCurrentPanel"]>().mockResolvedValue(undefined),
    notifyActiveThreadIdentityChanged: vi.fn<ThreadManagementActionsHost["notifyActiveThreadIdentityChanged"]>(),
    refreshAfterThreadMutation: vi.fn<ThreadManagementActionsHost["refreshAfterThreadMutation"]>().mockResolvedValue(undefined),
    recordForkedThread: vi.fn<ThreadManagementActionsHost["recordForkedThread"]>(),
  };
}

function rollbackSnapshot(overrides: Partial<ThreadRollbackSnapshot> = {}): ThreadRollbackSnapshot {
  return {
    thread: panelThread("source", { name: "Rolled Back Thread" }),
    cwd: "/vault",
    items: rollbackItems(),
    ...overrides,
  };
}

function panelThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
    ...overrides,
  };
}

function callOrder(fn: Mock): number {
  const order = fn.mock.invocationCallOrder[0];
  if (order === undefined) throw new Error("Expected function to be called.");
  return order;
}
