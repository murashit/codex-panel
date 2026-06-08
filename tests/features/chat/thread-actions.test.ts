import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import type { ArchiveExportAdapter } from "../../../src/domain/threads/export";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import { createChatThreadActions, type ChatThreadActionsHost } from "../../../src/features/chat/threads/thread-actions";
import type { DisplayItem } from "../../../src/features/chat/display/types";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";
import { notices } from "../../mocks/obsidian";

type MockArchiveExportAdapter = ArchiveExportAdapter & {
  exists: ReturnType<typeof vi.fn<ArchiveExportAdapter["exists"]>>;
  mkdir: ReturnType<typeof vi.fn<ArchiveExportAdapter["mkdir"]>>;
  write: ReturnType<typeof vi.fn<ArchiveExportAdapter["write"]>>;
};

describe("createChatThreadActions", () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it("requests thread compaction and reports the shared status", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: [] });
    const controller = createChatThreadActions(host);

    await controller.compactThread("source");

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
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
    const controller = createChatThreadActions(host);

    await controller.archiveThread("source");

    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(adapter.write).toHaveBeenCalledWith(
      "Archive/Archived Thread abcdef12.md",
      expect.stringContaining('thread_id: "abcdef12-9999"'),
    );
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(notices).toEqual(["Saved archived thread to Archive/Archived Thread abcdef12.md."]);
    expect(callOrder(adapter.write)).toBeLessThan(callOrder(client.archiveThread));
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
    const controller = createChatThreadActions(host);

    await controller.archiveThread("source");

    expect(client.readThread).toHaveBeenCalledWith("source", true);
    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("disk full");
  });

  it("forks from a selected turn by dropping later turns on the fork", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = createChatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-1", false);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.rollbackThread).toHaveBeenCalledWith("forked", 2);
    expect(host.openThreadInNewView).toHaveBeenCalledWith("forked");
    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
  });

  it("does not open the fork in a new panel before archiving the source", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = createChatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-2", true);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.rollbackThread).toHaveBeenCalledWith("forked", 1);
    expect(host.openThreadInNewView).not.toHaveBeenCalled();
    expect(client.archiveThread).toHaveBeenCalledWith("source");
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
    const controller = createChatThreadActions(host);

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
    const controller = createChatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.rollbackThread).not.toHaveBeenCalled();
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.openThreadInCurrentPanel).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("archive failed");
  });

  it("replaces the source panel before notifying surfaces after fork and archive succeeds", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = createChatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.openThreadInCurrentPanel).toHaveBeenCalledWith("forked");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    const openOrder = host.openThreadInCurrentPanel.mock.invocationCallOrder[0];
    const notifyOrder = host.notifyThreadArchived.mock.invocationCallOrder[0];
    if (openOrder === undefined || notifyOrder === undefined) throw new Error("Expected open and archive notification calls.");
    expect(openOrder).toBeLessThan(notifyOrder);
  });

  it("notifies surfaces when fork and archive succeeds but the fork cannot replace the source panel", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    host.openThreadInCurrentPanel.mockRejectedValue(new Error("resume failed"));
    const controller = createChatThreadActions(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Archived thread source, but could not open forked thread forked: resume failed");
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
    rollbackThread: vi.fn().mockResolvedValue({ thread: { id: "forked" } }),
    compactThread: vi.fn().mockResolvedValue({}),
    archiveThread: vi.fn().mockResolvedValue({}),
    readThread: vi.fn().mockResolvedValue({ thread: archivedThread() }),
    setThreadName: vi.fn(),
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
  const stateStore = createChatStateStore({ ...state, transcript: { ...state.transcript, displayItems } });
  return {
    stateStore,
    vaultPath: "/vault",
    settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
    archiveAdapter: () => archiveAdapter,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    currentClient: () => client as unknown as AppServerClient,
    history: {} as never,
    addSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    setComposerText: vi.fn(),
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

function archivedThread(): Thread {
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
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Archived Thread",
    turns: [],
  };
}

function callOrder(fn: ReturnType<typeof vi.fn>): number {
  const order = fn.mock.invocationCallOrder[0];
  if (order === undefined) throw new Error("Expected function to be called.");
  return order;
}
