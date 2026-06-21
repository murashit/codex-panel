import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import { archiveThreadOnAppServer } from "../../../../src/app-server/services/thread-archive";
import type { ArchiveExportAdapter } from "../../../../src/domain/threads/archive-markdown";
import { normalizeExplicitThreadName } from "../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import {
  createThreadManagementActions,
  type ThreadManagementActions,
  type ThreadManagementActionsHost,
} from "../../../../src/features/chat/application/threads/thread-management-actions";
import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";
import { DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { deferred, waitForAsyncWork } from "../../../support/async";
import { chatStateMessageStreamItems, withChatStateMessageStreamItems } from "../support/message-stream";
import { chatStateFixture } from "../support/state";

type MockArchiveExportAdapter = ArchiveExportAdapter & {
  exists: ReturnType<typeof vi.fn<ArchiveExportAdapter["exists"]>>;
  mkdir: ReturnType<typeof vi.fn<ArchiveExportAdapter["mkdir"]>>;
  write: ReturnType<typeof vi.fn<ArchiveExportAdapter["write"]>>;
};

describe("thread management actions", () => {
  it("requests thread compaction and reports the shared status", async () => {
    const client = clientMock();
    const host = hostMock({ client, items: [] });
    const controller = threadManagementActions(host);

    await controller.compactThread("source");

    expect(host.connectedClient).toHaveBeenCalledOnce();
    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
  });

  it("reports compacting without an active thread", async () => {
    const client = clientMock();
    const host = hostMock({ client, items: [] });
    const controller = threadManagementActions(host);

    await controller.compactActiveThread();

    expect(host.addSystemMessage).toHaveBeenCalledWith("No active thread to compact.");
    expect(client.compactThread).not.toHaveBeenCalled();
  });

  it("does not report compaction completion after the panel switches threads", async () => {
    const compact = deferred<undefined>();
    const client = clientMock();
    client.compactThread.mockReturnValue(compact.promise);
    const host = hostMock({ client, items: [] });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    const controller = threadManagementActions(host);

    const pendingCompact = controller.compactThread("source");
    await waitForAsyncWork(() => {
      expect(client.compactThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("other"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    compact.resolve(undefined);
    await pendingCompact;

    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("does not report compaction completion after the current client changes", async () => {
    const compact = deferred<undefined>();
    const firstClient = clientMock();
    const secondClient = clientMock();
    let currentClient = firstClient;
    firstClient.compactThread.mockReturnValue(compact.promise);
    const host = hostMock({ client: firstClient, currentClient: () => currentClient as unknown as AppServerClient, items: [] });
    const controller = threadManagementActions(host);

    const pendingCompact = controller.compactThread("source");
    await waitForAsyncWork(() => {
      expect(firstClient.compactThread).toHaveBeenCalledWith("source");
    });
    currentClient = secondClient;
    compact.resolve(undefined);
    await pendingCompact;

    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("saves archive markdown before archiving and notifying shared surfaces", async () => {
    const client = clientMock();
    const adapter = archiveAdapterMock();
    client.readThread.mockResolvedValue({ thread: archivedThread() });
    const host = hostMock({
      client,
      items: [],
      archiveAdapter: adapter,
      settings: {
        archiveExportEnabled: true,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
    });
    const controller = threadManagementActions(host);

    await controller.archiveThread("source");

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(adapter.write).toHaveBeenCalledWith(
      "Archive/Archived Thread abcdef12.md",
      expect.stringContaining('thread_id: "abcdef12-9999"'),
    );
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(host.showNotice).toHaveBeenCalledWith("Saved archived thread to Archive/Archived Thread abcdef12.md.");
    expect(callOrder(adapter.write)).toBeLessThan(callOrder(client.archiveThread));
    expect(callOrder(host.ensureConnected)).toBeLessThan(callOrder(client.readThread));
    expect(callOrder(client.archiveThread)).toBeLessThan(callOrder(host.notifyThreadArchived));
  });

  it("does not archive or notify surfaces when archive markdown export fails", async () => {
    const client = clientMock();
    const adapter = archiveAdapterMock({ write: vi.fn().mockRejectedValue(new Error("disk full")) });
    client.readThread.mockResolvedValue({ thread: archivedThread() });
    const host = hostMock({
      client,
      items: [],
      archiveAdapter: adapter,
      settings: {
        archiveExportEnabled: true,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
    });
    const controller = threadManagementActions(host);

    await controller.archiveThread("source");

    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("disk full");
  });

  it("forks from a selected turn by dropping later turns on the fork", async () => {
    const client = clientMock();
    const host = hostMock({ client, items: turnItems() });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-1", false);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.rollbackThread).toHaveBeenCalledWith("forked", 2);
    expect(host.recordThreadForked).toHaveBeenCalledWith(expect.objectContaining({ id: "forked" }));
    expect(host.openThreadInNewView).toHaveBeenCalledWith("forked");
    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("saves the source before replacing the panel during fork and archive", async () => {
    const client = clientMock();
    const adapter = archiveAdapterMock();
    client.readThread.mockResolvedValue({ thread: archivedThread() });
    const host = hostMock({
      client,
      items: turnItems(),
      archiveAdapter: adapter,
      settings: {
        archiveExportEnabled: true,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
    });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(adapter.write).toHaveBeenCalledWith("Archive/Archived Thread abcdef12.md", expect.any(String));
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(callOrder(adapter.write)).toBeLessThan(callOrder(client.archiveThread));
    expect(callOrder(client.archiveThread)).toBeLessThan(callOrder(host.notifyThreadArchived));
    expect(callOrder(host.notifyThreadArchived)).toBeLessThan(callOrder(host.openThreadInCurrentPanel));
  });

  it("keeps the source panel when fork and archive fails to archive", async () => {
    const client = clientMock();
    client.archiveThread.mockRejectedValue(new Error("archive failed"));
    const host = hostMock({ client, items: turnItems() });
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.rollbackThread).not.toHaveBeenCalled();
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("archive failed");
  });

  it("notifies surfaces when fork and archive succeeds but the fork cannot replace the source panel", async () => {
    const client = clientMock();
    const host = hostMock({ client, items: turnItems() });
    host.openThreadInCurrentPanel.mockRejectedValue(new Error("resume failed"));
    const controller = threadManagementActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Archived thread source, but could not open forked thread forked: resume failed");
  });

  it("does not archive or replace the panel from stale fork responses", async () => {
    const fork = deferred<{ thread: ThreadRecord }>();
    const client = clientMock();
    client.forkThread.mockReturnValue(fork.promise);
    const host = hostMock({ client, items: turnItems() });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    host.stateStore.dispatch({
      type: "thread-list/applied",
      threads: [{ ...panelThread("source"), name: "Source name" }],
      threadsLoaded: true,
    });
    const controller = threadManagementActions(host);

    const pendingFork = controller.forkThreadFromTurn("source", null, true);
    await waitForAsyncWork(() => {
      expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("other"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    fork.resolve({ thread: { ...archivedThread(), id: "forked", sessionId: "forked", name: null } });
    await pendingFork;

    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(client.setThreadName).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(host.notifyThreadRenamed).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
  });

  it("does not open or record fork responses after the current client changes", async () => {
    const fork = deferred<{ thread: ThreadRecord }>();
    const firstClient = clientMock();
    const secondClient = clientMock();
    let currentClient = firstClient;
    firstClient.forkThread.mockReturnValue(fork.promise);
    const host = hostMock({
      client: firstClient,
      currentClient: () => currentClient as unknown as AppServerClient,
      items: turnItems(),
    });
    const controller = threadManagementActions(host);

    const pendingFork = controller.forkThreadFromTurn("source", null, false);
    await waitForAsyncWork(() => {
      expect(firstClient.forkThread).toHaveBeenCalledWith("source", "/vault");
    });
    currentClient = secondClient;
    fork.resolve({ thread: archivedThread() });
    await pendingFork;

    expect(host.recordThreadForked).not.toHaveBeenCalled();
    expect(host.openThreadInNewView).not.toHaveBeenCalled();
    expect(firstClient.archiveThread).not.toHaveBeenCalled();
  });

  it("renames a thread and notifies shared surfaces", async () => {
    const client = clientMock();
    const host = hostMock({ client, items: [] });
    host.stateStore.dispatch({ type: "thread-list/applied", threads: [{ ...panelThread("thread"), name: "Old" }] });
    const controller = threadManagementActions(host);

    await expect(controller.renameThread("thread", " Slash   command title ")).resolves.toBe(true);

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.setThreadName).toHaveBeenCalledWith("thread", "Slash command title");
    expect(host.stateStore.getState().threadList.listedThreads[0]?.name).toBe("Old");
    expect(host.notifyThreadRenamed).toHaveBeenCalledWith("thread", "Slash command title");
  });

  it("ignores empty thread rename titles", async () => {
    const client = clientMock();
    const host = hostMock({ client, items: [] });
    const controller = threadManagementActions(host);

    await expect(controller.renameThread("thread", "   ")).resolves.toBe(false);

    expect(host.ensureConnected).not.toHaveBeenCalled();
    expect(client.setThreadName).not.toHaveBeenCalled();
    expect(host.notifyThreadRenamed).not.toHaveBeenCalled();
  });

  it("applies rollback response turns before refreshing shared thread state", async () => {
    const client = clientMock();
    const host = hostMock({ client, items: turnItems() });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    host.stateStore.dispatch({
      type: "message-stream/items-replaced",
      items: turnItems(),
      historyCursor: null,
      loadingHistory: false,
    });
    const controller = threadManagementActions(host);

    await controller.rollbackThread("source");

    expect(client.rollbackThread).toHaveBeenCalledWith("source");
    expect(chatStateMessageStreamItems(host.stateStore.getState()).slice(0, 2)).toMatchObject([
      { kind: "message", role: "user", text: "kept prompt", turnId: "kept-turn" },
      { kind: "message", role: "assistant", text: "kept answer", turnId: "kept-turn" },
    ]);
    expect(callOrder(host.setComposerText)).toBeLessThan(callOrder(host.addSystemMessage));
    expect(callOrder(host.addSystemMessage)).toBeLessThan(callOrder(host.refreshAfterThreadMutation));
  });

  it("ignores stale rollback responses after the panel switches threads", async () => {
    const rollback = deferred<{ thread: ThreadRecord }>();
    const client = clientMock();
    client.rollbackThread.mockReturnValue(rollback.promise);
    const host = hostMock({ client, items: turnItems() });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
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
      expect(client.rollbackThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("other"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    rollback.resolve({ thread: rollbackThread() });
    await pendingRollback;

    expect(host.stateStore.getState().activeThread.id).toBe("other");
    expect(host.setComposerText).not.toHaveBeenCalled();
    expect(host.notifyActiveThreadIdentityChanged).not.toHaveBeenCalled();
    expect(host.refreshAfterThreadMutation).not.toHaveBeenCalled();
  });

  it("ignores rollback responses after the current client changes", async () => {
    const rollback = deferred<{ thread: ThreadRecord }>();
    const firstClient = clientMock();
    const secondClient = clientMock();
    let currentClient = firstClient;
    firstClient.rollbackThread.mockReturnValue(rollback.promise);
    const host = hostMock({
      client: firstClient,
      currentClient: () => currentClient as unknown as AppServerClient,
      items: turnItems(),
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      thread: panelThread("source"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
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
      expect(firstClient.rollbackThread).toHaveBeenCalledWith("source");
    });
    currentClient = secondClient;
    rollback.resolve({ thread: rollbackThread() });
    await pendingRollback;

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

function clientMock() {
  return {
    forkThread: vi.fn().mockResolvedValue({ thread: { ...archivedThread(), id: "forked", sessionId: "forked", name: null } }),
    rollbackThread: vi.fn().mockResolvedValue({ thread: rollbackThread() }),
    compactThread: vi.fn().mockResolvedValue({}),
    archiveThread: vi.fn().mockResolvedValue({}),
    readThread: vi.fn().mockResolvedValue({ thread: archivedThread() }),
    setThreadName: vi.fn(),
  };
}

function threadManagementActions(host: ThreadManagementActionsHost): ThreadManagementActions {
  return createThreadManagementActions(host);
}

function hostMock({
  client,
  items,
  archiveAdapter = archiveAdapterMock(),
  settings = {},
  currentClient,
}: {
  client: ReturnType<typeof clientMock>;
  items: MessageStreamItem[];
  archiveAdapter?: ArchiveExportAdapter;
  settings?: Partial<typeof DEFAULT_SETTINGS>;
  currentClient?: () => AppServerClient | null;
}) {
  const state = withChatStateMessageStreamItems(chatStateFixture(), items);
  const stateStore = createChatStateStore(state);
  const notifyThreadArchived = vi.fn();
  const notifyThreadRenamed = vi.fn();
  const showNotice = vi.fn();
  const ensureConnected = vi.fn().mockResolvedValue(undefined);
  const connectedClient = vi.fn(async () => {
    await ensureConnected();
    return (currentClient ?? (() => client as unknown as AppServerClient))();
  });
  return {
    stateStore,
    vaultPath: "/vault",
    ensureConnected,
    connectedClient,
    currentClient: currentClient ?? (() => client as unknown as AppServerClient),
    addSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    setComposerText: vi.fn(),
    openThreadInNewView: vi.fn().mockResolvedValue(undefined),
    openThreadInCurrentPanel: vi.fn().mockResolvedValue(undefined),
    operations: {
      archiveThread: vi.fn(async (threadId: string, options: { saveMarkdown?: boolean } = {}) => {
        await ensureConnected();
        const result = await archiveThreadOnAppServer(client as unknown as AppServerClient, threadId, {
          settings: { ...DEFAULT_SETTINGS, ...settings },
          vaultPath: "/vault",
          archiveAdapter: () => archiveAdapter,
          saveMarkdown: options.saveMarkdown ?? settings.archiveExportEnabled ?? DEFAULT_SETTINGS.archiveExportEnabled,
        });
        if (result.exportedPath) showNotice(`Saved archived thread to ${result.exportedPath}.`);
        notifyThreadArchived(threadId);
        return result;
      }),
      renameThread: vi.fn(async (threadId: string, value: string) => {
        const name = normalizeExplicitThreadName(value);
        if (!name) return false;
        await ensureConnected();
        await client.setThreadName(threadId, name);
        notifyThreadRenamed(threadId, name);
        return true;
      }),
    },
    showNotice,
    notifyThreadArchived,
    notifyThreadRenamed,
    notifyActiveThreadIdentityChanged: vi.fn(),
    refreshAfterThreadMutation: vi.fn().mockResolvedValue(undefined),
    recordThreadForked: vi.fn(),
  };
}

function archiveAdapterMock(overrides: Partial<MockArchiveExportAdapter> = {}): MockArchiveExportAdapter {
  return {
    exists: vi.fn<ArchiveExportAdapter["exists"]>().mockResolvedValue(false),
    mkdir: vi.fn<ArchiveExportAdapter["mkdir"]>().mockResolvedValue(undefined),
    write: vi.fn<ArchiveExportAdapter["write"]>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function archivedThread(): ThreadRecord {
  return {
    id: "abcdef12-9999",
    sessionId: "abcdef12-9999",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "codex-cli 0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Archived Thread",
    turns: [],
  };
}

function rollbackThread(): ThreadRecord {
  return {
    ...archivedThread(),
    id: "forked",
    sessionId: "forked",
    name: "Rolled Back Thread",
    turns: [
      {
        id: "kept-turn",
        items: [
          { type: "userMessage", id: "kept-user", clientId: null, content: [{ type: "text", text: "kept prompt", text_elements: [] }] },
          { type: "agentMessage", id: "kept-agent", text: "kept answer", phase: "final_answer", memoryCitation: null },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1000,
      },
    ],
  };
}

function panelThread(id: string) {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
  };
}

function callOrder(fn: ReturnType<typeof vi.fn>): number {
  const order = fn.mock.invocationCallOrder[0];
  if (order === undefined) throw new Error("Expected function to be called.");
  return order;
}
