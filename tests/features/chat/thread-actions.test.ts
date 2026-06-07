import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import {
  ChatThreadActionController,
  type ChatThreadActionControllerHost,
} from "../../../src/features/chat/controllers/thread/thread-actions-controller";
import type { DisplayItem } from "../../../src/features/chat/display/types";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";

describe("ChatThreadActionController", () => {
  it("requests thread compaction and reports the shared status", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: [] });
    const controller = new ChatThreadActionController(host);

    await controller.compactThread("source");

    expect(host.ensureConnected).toHaveBeenCalledOnce();
    expect(client.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
  });

  it("forks from a selected turn by dropping later turns on the fork", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = new ChatThreadActionController(host);

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
    const controller = new ChatThreadActionController(host);

    await controller.forkThreadFromTurn("source", "turn-2", true);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.rollbackThread).toHaveBeenCalledWith("forked", 1);
    expect(host.openThreadInNewView).not.toHaveBeenCalled();
    expect(client.archiveThread).toHaveBeenCalledWith("source");
  });

  it("keeps the source panel when fork and archive fails to archive", async () => {
    const client = clientMock();
    client.archiveThread.mockRejectedValue(new Error("archive failed"));
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = new ChatThreadActionController(host);

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
    const controller = new ChatThreadActionController(host);

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
    const controller = new ChatThreadActionController(host);

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
    readThread: vi.fn(),
    setThreadName: vi.fn(),
  };
}

function hostMock({ client, displayItems }: { client: ReturnType<typeof clientMock>; displayItems: DisplayItem[] }) {
  const state = createChatState();
  const stateStore = createChatStateStore({ ...state, transcript: { ...state.transcript, displayItems } });
  return {
    stateStore,
    vaultPath: "/vault",
    settings: () => DEFAULT_SETTINGS,
    archiveAdapter: vi.fn(),
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
  } satisfies ChatThreadActionControllerHost;
}
