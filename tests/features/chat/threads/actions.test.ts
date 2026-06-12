import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { ThreadRecord } from "../../../../src/app-server/protocol/thread";
import type { ArchiveExportAdapter } from "../../../../src/features/thread-export/archive-markdown";
import { createChatState, createChatStateStore } from "../../../../src/features/chat/state/reducer";
import { archiveThread } from "../../../../src/features/chat/threads/archive-actions";
import { compactThread } from "../../../../src/features/chat/threads/compact-actions";
import { forkThreadFromTurn } from "../../../../src/features/chat/threads/fork-actions";
import { renameThread } from "../../../../src/features/chat/threads/rename-actions";
import { rollbackThread as rollbackThreadAction } from "../../../../src/features/chat/threads/rollback-actions";
import type { ChatThreadActions, ChatThreadActionsHost } from "../../../../src/features/chat/threads/action-context";
import type { DisplayItem } from "../../../../src/features/chat/display/types";
import { DEFAULT_SETTINGS } from "../../../../src/settings/model";
import { notices } from "../../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../../support/async";

type MockArchiveExportAdapter = ArchiveExportAdapter & {
  exists: ReturnType<typeof vi.fn<ArchiveExportAdapter["exists"]>>;
  mkdir: ReturnType<typeof vi.fn<ArchiveExportAdapter["mkdir"]>>;
  write: ReturnType<typeof vi.fn<ArchiveExportAdapter["write"]>>;
};

describe("chat thread actions", () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it("requests thread compaction and reports the shared status", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: [] });
    const controller = chatThreadActions(host);

    await controller.compactThread("source");

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
  });

  it("does not report compaction completion after the panel switches threads", async () => {
    const compact = deferred<undefined>();
    const client = clientMock();
    client.compactThread.mockReturnValue(compact.promise);
    const host = hostMock({ client, displayItems: [] });
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
    const controller = chatThreadActions(host);

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

  it("saves archive markdown before archiving and notifying shared surfaces", async () => {
    const client = clientMock();
    const adapter = archiveAdapterMock();
    client.readThread.mockResolvedValue({ thread: archivedThread() });
    const host = hostMock({
      client,
      displayItems: [],
      archiveAdapter: adapter,
      settings: {
        archiveExportEnabled: true,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
    });
    const controller = chatThreadActions(host);

    await controller.archiveThread("source");

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(adapter.write).toHaveBeenCalledWith(
      "Archive/Archived Thread abcdef12.md",
      expect.stringContaining('thread_id: "abcdef12-9999"'),
    );
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(notices).toEqual(["Saved archived thread to Archive/Archived Thread abcdef12.md."]);
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
      displayItems: [],
      archiveAdapter: adapter,
      settings: {
        archiveExportEnabled: true,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
    });
    const controller = chatThreadActions(host);

    await controller.archiveThread("source");

    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("disk full");
  });

  it("forks from a selected turn by dropping later turns on the fork", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = chatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-1", false);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.rollbackThread).toHaveBeenCalledWith("forked", 2);
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
      displayItems: turnItems(),
      archiveAdapter: adapter,
      settings: {
        archiveExportEnabled: true,
        archiveExportFolderTemplate: "Archive",
        archiveExportFilenameTemplate: "{{title}} {{shortId}}",
      },
    });
    const controller = chatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(adapter.write).toHaveBeenCalledWith("Archive/Archived Thread abcdef12.md", expect.any(String));
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(callOrder(adapter.write)).toBeLessThan(callOrder(client.archiveThread));
    expect(callOrder(client.archiveThread)).toBeLessThan(callOrder(host.openThreadInCurrentPanel));
    expect(callOrder(host.openThreadInCurrentPanel)).toBeLessThan(callOrder(host.notifyThreadArchived));
  });

  it("keeps the source panel when fork and archive fails to archive", async () => {
    const client = clientMock();
    client.archiveThread.mockRejectedValue(new Error("archive failed"));
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = chatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.rollbackThread).not.toHaveBeenCalled();
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("archive failed");
  });

  it("notifies surfaces when fork and archive succeeds but the fork cannot replace the source panel", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    host.openThreadInCurrentPanel.mockRejectedValue(new Error("resume failed"));
    const controller = chatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Archived thread source, but could not open forked thread forked: resume failed");
  });

  it("does not archive or replace the panel from stale fork responses", async () => {
    const fork = deferred<{ thread: { id: string } }>();
    const client = clientMock();
    client.forkThread.mockReturnValue(fork.promise);
    const host = hostMock({ client, displayItems: turnItems() });
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
    const controller = chatThreadActions(host);

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
    fork.resolve({ thread: { id: "forked" } });
    await pendingFork;

    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(client.setThreadName).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(host.notifyThreadRenamed).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
  });

  it("renames a thread and notifies shared surfaces", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: [] });
    host.stateStore.dispatch({ type: "thread-list/applied", threads: [{ ...panelThread("thread"), name: "Old" }] });
    const controller = chatThreadActions(host);

    await expect(controller.renameThread("thread", " Slash command title ")).resolves.toBe(true);

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.setThreadName).toHaveBeenCalledWith("thread", "Slash command title");
    expect(host.stateStore.getState().threadList.listedThreads[0]?.name).toBe("Slash command title");
    expect(host.notifyThreadRenamed).toHaveBeenCalledWith("thread", "Slash command title");
    expect(host.render).toHaveBeenCalledOnce();
  });

  it("ignores empty thread rename titles", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: [] });
    const controller = chatThreadActions(host);

    await expect(controller.renameThread("thread", "   ")).resolves.toBe(false);

    expect(host.ensureConnected).not.toHaveBeenCalled();
    expect(client.setThreadName).not.toHaveBeenCalled();
    expect(host.notifyThreadRenamed).not.toHaveBeenCalled();
  });

  it("applies rollback response turns directly before refreshing the shell", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
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
    host.stateStore.dispatch({ type: "message-stream/items-replaced", items: turnItems(), historyCursor: null, loadingHistory: false });
    const controller = chatThreadActions(host);

    await controller.rollbackThread("source");

    expect(client.rollbackThread).toHaveBeenCalledWith("source");
    expect(host.stateStore.getState().messageStream.displayItems.slice(0, 2)).toMatchObject([
      { kind: "message", role: "user", text: "kept prompt", turnId: "kept-turn" },
      { kind: "message", role: "assistant", text: "kept answer", turnId: "kept-turn" },
    ]);
    expect(host.render).toHaveBeenCalledOnce();
    expect(callOrder(host.setComposerText)).toBeLessThan(callOrder(host.addSystemMessage));
    expect(callOrder(host.addSystemMessage)).toBeLessThan(callOrder(host.render));
    expect(callOrder(host.render)).toBeLessThan(callOrder(vi.mocked(host.refreshThreads)));
    expect(callOrder(vi.mocked(host.refreshThreads))).toBeLessThan(callOrder(host.refreshSharedThreadListFromOpenSurface));
  });

  it("ignores stale rollback responses after the panel switches threads", async () => {
    const rollback = deferred<{ thread: ThreadRecord }>();
    const client = clientMock();
    client.rollbackThread.mockReturnValue(rollback.promise);
    const host = hostMock({ client, displayItems: turnItems() });
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
    host.stateStore.dispatch({ type: "message-stream/items-replaced", items: turnItems(), historyCursor: null, loadingHistory: false });
    const controller = chatThreadActions(host);

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
    expect(host.refreshSharedThreadListFromOpenSurface).not.toHaveBeenCalled();
  });
});

function turnItems(): DisplayItem[] {
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
    forkThread: vi.fn().mockResolvedValue({ thread: { id: "forked" } }),
    rollbackThread: vi.fn().mockResolvedValue({ thread: rollbackThread() }),
    compactThread: vi.fn().mockResolvedValue({}),
    archiveThread: vi.fn().mockResolvedValue({}),
    readThread: vi.fn().mockResolvedValue({ thread: archivedThread() }),
    setThreadName: vi.fn(),
  };
}

function chatThreadActions(host: ChatThreadActionsHost): ChatThreadActions {
  return {
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown) => archiveThread(host, threadId, saveMarkdown),
    forkThread: (threadId) => forkThreadFromTurn(host, threadId, null, false),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId) => rollbackThreadAction(host, threadId),
  };
}

function hostMock({
  client,
  displayItems,
  archiveAdapter = archiveAdapterMock(),
  settings = {},
}: {
  client: ReturnType<typeof clientMock>;
  displayItems: DisplayItem[];
  archiveAdapter?: ArchiveExportAdapter;
  settings?: Partial<typeof DEFAULT_SETTINGS>;
}) {
  const state = createChatState();
  const stateStore = createChatStateStore({ ...state, messageStream: { ...state.messageStream, displayItems } });
  return {
    stateStore,
    vaultPath: "/vault",
    settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
    archiveAdapter: () => archiveAdapter,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    currentClient: () => client as unknown as AppServerClient,
    addSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    setComposerText: vi.fn(),
    render: vi.fn(),
    openThreadInNewView: vi.fn().mockResolvedValue(undefined),
    openThreadInCurrentPanel: vi.fn().mockResolvedValue(undefined),
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    refreshThreads: vi.fn().mockResolvedValue(undefined),
    refreshSharedThreadListFromOpenSurface: vi.fn(),
  } satisfies ChatThreadActionsHost;
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
