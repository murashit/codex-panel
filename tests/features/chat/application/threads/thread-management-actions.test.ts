import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { activeThreadId } from "../../../../../src/features/chat/application/state/root-reducer";
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
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred, waitForAsyncWork } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { chatStateThreadStreamItems, withChatStateThreadStreamItems } from "../../support/thread-stream";

interface ThreadMutationTransportMock {
  ensureConnected: Mock<ThreadMutationTransport["ensureConnected"]>;
  compactThread: Mock<ThreadMutationTransport["compactThread"]>;
  forkThread: Mock<ThreadMutationTransport["forkThread"]>;
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
  | "recordThread"
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
  recordThread: Mock<ThreadManagementActionsHost["recordThread"]>;
};

describe("thread management actions", () => {
  it("allows direct compaction of an active side chat", async () => {
    const host = hostMock({
      items: [],
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });

    await threadManagementActions(host).compactThread("side-thread");

    expect(host.threadTransport.compactThread).toHaveBeenCalledWith("side-thread");
  });

  it("does not compact an old panel target after connection completes", async () => {
    const connection = deferred<boolean>();
    const host = hostMock({
      items: [],
      activeThread: { id: "source" },
      threadTransport: { ensureConnected: vi.fn(() => connection.promise) },
    });
    const compacting = threadManagementActions(host).compactThread("source");
    await waitForAsyncWork(() => expect(host.threadTransport.ensureConnected).toHaveBeenCalledOnce());

    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    connection.resolve(true);
    await compacting;

    expect(host.threadTransport.compactThread).not.toHaveBeenCalled();
    expect(activeThreadId(host.stateStore.getState())).toBe("other");
  });

  it("does not fork an ephemeral side chat", async () => {
    const host = hostMock({
      items: [],
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    const controller = threadManagementActions(host);

    await controller.forkThread("side-thread");

    expect(host.threadTransport.forkThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Side chats cannot be forked.");
  });

  it.each([
    {
      name: "fork",
      invoke: (actions: ThreadManagementActions) => actions.forkThread("agent-thread"),
      transport: "forkThread" as const,
      message: "Agent threads cannot be forked.",
    },
    {
      name: "rollback",
      invoke: (actions: ThreadManagementActions) => actions.rollbackThread("agent-thread"),
      transport: "rollbackThread" as const,
      message: "Agent threads cannot be rolled back.",
    },
  ])("rejects $name mutations for subagent threads", async ({ invoke, transport, message }) => {
    const host = hostMock({
      items: turnItems(),
      activeThread: {
        id: "agent-thread",
        provenance: {
          kind: "subagent",
          subagentKind: "thread-spawn",
          parentThreadId: "parent",
          sessionId: "session",
          depth: 1,
          agentNickname: "Scout",
          agentRole: "explorer",
        },
      },
    });

    await invoke(threadManagementActions(host));

    expect(host.threadTransport[transport]).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith(message);
  });

  it.each([
    {
      name: "archive",
      invoke: (actions: ThreadManagementActions) => actions.archiveThread("source"),
      operation: "archiveThread" as const,
      message: "Finish or interrupt the current turn before archiving threads.",
    },
    {
      name: "fork",
      invoke: (actions: ThreadManagementActions) => actions.forkThread("source"),
      operation: "forkThread" as const,
      message: "Finish or interrupt the current turn before forking threads.",
    },
    {
      name: "rollback",
      invoke: (actions: ThreadManagementActions) => actions.rollbackThread("source"),
      operation: "rollbackThread" as const,
      message: "Interrupt the current turn before rolling back.",
    },
  ])("rejects $name while a turn is busy", async ({ invoke, operation, message }) => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    host.stateStore.dispatch({ type: "turn/started", threadId: "source", turnId: "turn-running" });

    await invoke(threadManagementActions(host));

    if (operation === "archiveThread") expect(host.operations.archiveThread).not.toHaveBeenCalled();
    else expect(host.threadTransport[operation]).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith(message);
  });

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
    const compact = deferred<EffectOutcome<void>>();
    const host = hostMock({ items: [] });
    host.threadTransport.compactThread.mockReturnValue(compact.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
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
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    compact.resolve(completedCurrent(undefined));
    await pendingCompact;

    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("does not report compaction completion when the transport rejects the mutation", async () => {
    const host = hostMock({
      items: [],
      threadTransport: {
        compactThread: vi.fn<ThreadMutationTransport["compactThread"]>().mockResolvedValue({ kind: "not-started" }),
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

  it("rejects archiving a thread that is active in another panel", async () => {
    const host = hostMock({ items: [] });
    vi.mocked(host.threadHasPendingOrRunningPanel).mockReturnValue(true);

    await threadManagementActions(host).archiveThread("source");

    expect(host.operations.archiveThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the thread before archiving it.");
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

  it("forks through a selected turn", async () => {
    const host = hostMock({ items: turnItems() });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-1", false);

    expect(host.threadTransport.forkThread).toHaveBeenCalledWith("source", "turn-1");
    expect(host.recordThread).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "forked",
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

    expect(host.threadTransport.forkThread).toHaveBeenCalledWith("source", "turn-3");
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
    const fork = deferred<EffectOutcome<Thread>>();
    const host = hostMock({ items: turnItems() });
    host.threadTransport.forkThread.mockReturnValue(fork.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-list/applied",
      threads: [{ ...panelThread("source"), name: "Source name" }],
    });
    const controller = threadManagementActions(host);

    const pendingFork = controller.forkThreadFromTurn("source", null, true);
    await waitForAsyncWork(() => {
      expect(host.threadTransport.forkThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    fork.resolve(completedCurrent(panelThread("forked")));
    await pendingFork;

    expect(host.operations.archiveThread).not.toHaveBeenCalled();
    expect(host.operations.renameThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("does not archive the source when the panel changes during fork naming", async () => {
    const rename = deferred<boolean>();
    const host = hostMock({
      items: turnItems(),
      activeThread: { id: "source" },
      operations: { renameThread: vi.fn(() => rename.promise) },
    });
    host.stateStore.dispatch({
      type: "thread-list/applied",
      threads: [{ ...panelThread("source"), name: "Source name" }],
    });

    const pendingFork = threadManagementActions(host).forkThreadFromTurn("source", null, true);
    await waitForAsyncWork(() => expect(host.operations.renameThread).toHaveBeenCalledWith("forked", "Source name"));
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    rename.resolve(true);
    await pendingFork;

    expect(host.operations.archiveThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("does not replace a newer panel after fork source archiving completes", async () => {
    const archive = deferred<boolean>();
    const host = hostMock({
      items: turnItems(),
      activeThread: { id: "source" },
      operations: { archiveThread: vi.fn(() => archive.promise) },
    });

    const pendingFork = threadManagementActions(host).forkThreadFromTurn("source", null, true);
    await waitForAsyncWork(() => expect(host.operations.archiveThread).toHaveBeenCalledWith("source", {}));
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    archive.resolve(true);
    await pendingFork;

    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(activeThreadId(host.stateStore.getState())).toBe("other");
  });

  it("does not open or record fork responses when the transport has no result", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: { id: "source" },
      threadTransport: {
        forkThread: vi.fn<ThreadMutationTransport["forkThread"]>().mockResolvedValue({ kind: "not-started" }),
      },
    });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", null, false);

    expect(host.recordThread).not.toHaveBeenCalled();
    expect(host.openThreadInNewView).not.toHaveBeenCalled();
    expect(host.operations.archiveThread).not.toHaveBeenCalled();
  });

  it("records a fork that completed before its app-server context became stale", async () => {
    const host = hostMock({
      items: turnItems(),
      threadTransport: {
        forkThread: vi
          .fn<ThreadMutationTransport["forkThread"]>()
          .mockResolvedValue({ kind: "completed-stale", value: panelThread("forked") }),
      },
    });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", null, true);

    expect(host.recordThread).toHaveBeenCalledWith(panelThread("forked"));
    expect(host.operations.renameThread).not.toHaveBeenCalled();
    expect(host.operations.archiveThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
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
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadManagementActions(host);

    await controller.rollbackThread("source");

    expect(host.threadTransport.rollbackThread).toHaveBeenCalledWith("source");
    expect(chatStateThreadStreamItems(host.stateStore.getState()).slice(0, 2)).toMatchObject([
      { kind: "dialogue", role: "user", text: "kept prompt", turnId: "kept-turn" },
      { kind: "dialogue", role: "assistant", text: "kept answer", turnId: "kept-turn" },
    ]);
    expect(callOrder(host.setComposerText)).toBeLessThan(callOrder(host.addSystemMessage));
    expect(host.recordThread).toHaveBeenCalledWith(rollbackSnapshot().thread);
  });

  it("does not roll back an ephemeral side chat", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    const controller = threadManagementActions(host);

    await controller.rollbackThread("side-thread");

    expect(host.threadTransport.rollbackThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Side chats cannot be rolled back.");
  });

  it("ignores stale rollback responses after the panel switches threads", async () => {
    const rollback = deferred<EffectOutcome<ThreadRollbackSnapshot>>();
    const host = hostMock({ items: turnItems() });
    host.threadTransport.rollbackThread.mockReturnValue(rollback.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-stream/items-replaced",
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
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    rollback.resolve(completedCurrent(rollbackSnapshot()));
    await pendingRollback;

    expect(activeThreadId(host.stateStore.getState())).toBe("other");
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
    expect(host.recordThread).not.toHaveBeenCalled();
  });

  it("ignores rollback responses after a new turn starts in the same thread", async () => {
    const rollback = deferred<EffectOutcome<ThreadRollbackSnapshot>>();
    const host = hostMock({ items: turnItems() });
    host.threadTransport.rollbackThread.mockReturnValue(rollback.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({ type: "thread-stream/items-replaced", items: turnItems(), historyCursor: null, loadingHistory: false });
    const controller = threadManagementActions(host);

    const pendingRollback = controller.rollbackThread("source");
    await waitForAsyncWork(() => expect(host.threadTransport.rollbackThread).toHaveBeenCalledOnce());
    host.stateStore.dispatch({ type: "turn/started", threadId: "source", turnId: "new-turn" });
    rollback.resolve(completedCurrent(rollbackSnapshot()));
    await pendingRollback;

    expect(host.stateStore.getState().turn.lifecycle).toEqual({ kind: "running", turnId: "new-turn" });
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.recordThread).not.toHaveBeenCalled();
  });

  it("does not publish rollback facts from a stale app-server context", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: { id: "source" },
      threadTransport: {
        rollbackThread: vi
          .fn<ThreadMutationTransport["rollbackThread"]>()
          .mockResolvedValue({ kind: "completed-stale", value: rollbackSnapshot() }),
      },
    });
    const controller = threadManagementActions(host);

    await controller.rollbackThread("source");

    expect(host.recordThread).not.toHaveBeenCalled();
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
  });

  it("ignores rollback when the transport has no result", async () => {
    const host = hostMock({
      items: turnItems(),
      threadTransport: {
        rollbackThread: vi.fn<ThreadMutationTransport["rollbackThread"]>().mockResolvedValue({ kind: "not-started" }),
      },
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    host.stateStore.dispatch({
      type: "thread-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadManagementActions(host);

    await controller.rollbackThread("source");

    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
    expect(host.recordThread).not.toHaveBeenCalled();
  });
});

function turnItems(): ThreadStreamItem[] {
  return [
    { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "one", turnId: "turn-1" },
    {
      id: "a1",
      kind: "dialogue",
      role: "assistant",
      text: "one answer",
      turnId: "turn-1",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "two", turnId: "turn-2" },
    {
      id: "a2",
      kind: "dialogue",
      role: "assistant",
      text: "two answer",
      turnId: "turn-2",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u3", kind: "dialogue", dialogueKind: "user", role: "user", text: "three", turnId: "turn-3" },
    {
      id: "a3",
      kind: "dialogue",
      role: "assistant",
      text: "three answer",
      turnId: "turn-3",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
  ];
}

function rollbackItems(): ThreadStreamItem[] {
  return [
    { id: "kept-user", kind: "dialogue", dialogueKind: "user", role: "user", text: "kept prompt", turnId: "kept-turn" },
    {
      id: "kept-agent",
      kind: "dialogue",
      role: "assistant",
      text: "kept answer",
      turnId: "kept-turn",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
  ];
}

function threadManagementActions(host: ThreadManagementActionsHost): ThreadManagementActions {
  return createThreadManagementActions(host);
}

function hostMock({
  items,
  activeThread,
  operations: operationOverrides = {},
  threadTransport: transportOverrides = {},
}: {
  items: ThreadStreamItem[];
  activeThread?: NonNullable<Parameters<typeof chatStateWith>[1]["activeThread"]>;
  operations?: Partial<ThreadOperationsMock>;
  threadTransport?: Partial<ThreadMutationTransportMock>;
}): ThreadManagementActionsHostMock {
  let state = withChatStateThreadStreamItems(chatStateFixture(), items);
  if (activeThread) state = chatStateWith(state, { activeThread });
  const stateStore = createChatStateStore(state);
  const threadTransport: ThreadMutationTransportMock = {
    ensureConnected: vi.fn<ThreadMutationTransport["ensureConnected"]>().mockResolvedValue(true),
    compactThread: vi.fn<ThreadMutationTransport["compactThread"]>().mockResolvedValue(completedCurrent(undefined)),
    forkThread: vi.fn<ThreadMutationTransport["forkThread"]>().mockResolvedValue(completedCurrent(panelThread("forked"))),
    rollbackThread: vi.fn<ThreadMutationTransport["rollbackThread"]>().mockResolvedValue(completedCurrent(rollbackSnapshot())),
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
    recordThread: vi.fn<ThreadManagementActionsHost["recordThread"]>(),
    threadHasPendingOrRunningPanel: vi.fn(() => false),
  };
}

function rollbackSnapshot(overrides: Partial<ThreadRollbackSnapshot> = {}): ThreadRollbackSnapshot {
  return {
    thread: panelThread("source", { name: "Rolled Back Thread" }),
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
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

function callOrder(fn: Mock): number {
  const order = fn.mock.invocationCallOrder[0];
  if (order === undefined) throw new Error("Expected function to be called.");
  return order;
}

function completedCurrent<T>(value: T): EffectOutcome<T> {
  return { kind: "completed-current", value };
}
