import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import { ChatThreadActionController, type ChatThreadActionControllerHost } from "../../../src/features/chat/thread-actions";
import type { DisplayItem } from "../../../src/features/chat/display/types";
import { DEFAULT_SETTINGS } from "../../../src/settings/model";

describe("ChatThreadActionController", () => {
  it("forks from a selected turn by dropping later turns on the fork", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = new ChatThreadActionController(host);

    await controller.forkThreadFromTurn("source", "turn-1", false);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.rollbackThread).toHaveBeenCalledWith("forked", 2);
    expect(host.openThreadInNewView).toHaveBeenCalledWith("forked");
    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(host.closePanel).not.toHaveBeenCalled();
  });

  it("does not archive the source when fork and archive cannot open the fork panel", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    host.openThreadInNewView.mockRejectedValue(new Error("no panel"));
    const controller = new ChatThreadActionController(host);

    await controller.forkThreadFromTurn("source", "turn-2", true);

    expect(client.forkThread).toHaveBeenCalledWith("source", "/vault");
    expect(client.rollbackThread).toHaveBeenCalledWith("forked", 1);
    expect(client.archiveThread).not.toHaveBeenCalled();
    expect(host.closePanel).not.toHaveBeenCalled();
  });

  it("does not close the source panel when fork and archive fails to archive", async () => {
    const client = clientMock();
    client.archiveThread.mockRejectedValue(new Error("archive failed"));
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = new ChatThreadActionController(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.rollbackThread).not.toHaveBeenCalled();
    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.closePanel).not.toHaveBeenCalled();
    expect(host.notifyThreadArchived).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("archive failed");
  });

  it("closes the source panel before notifying surfaces after fork and archive succeeds", async () => {
    const client = clientMock();
    const host = hostMock({ client, displayItems: turnItems() });
    const controller = new ChatThreadActionController(host);

    await controller.forkThreadFromTurn("source", "turn-3", true);

    expect(client.archiveThread).toHaveBeenCalledWith("source");
    expect(host.closePanel).toHaveBeenCalledOnce();
    expect(host.notifyThreadArchived).toHaveBeenCalledWith("source");
    const closeOrder = host.closePanel.mock.invocationCallOrder[0];
    const notifyOrder = host.notifyThreadArchived.mock.invocationCallOrder[0];
    if (closeOrder === undefined || notifyOrder === undefined) throw new Error("Expected close and archive notification calls.");
    expect(closeOrder).toBeLessThan(notifyOrder);
  });
});

function turnItems(): DisplayItem[] {
  return [
    { id: "u1", kind: "message", role: "user", text: "one", turnId: "turn-1", markdown: true },
    { id: "a1", kind: "message", role: "assistant", text: "one answer", turnId: "turn-1", markdown: true },
    { id: "u2", kind: "message", role: "user", text: "two", turnId: "turn-2", markdown: true },
    { id: "a2", kind: "message", role: "assistant", text: "two answer", turnId: "turn-2", markdown: true },
    { id: "u3", kind: "message", role: "user", text: "three", turnId: "turn-3", markdown: true },
    { id: "a3", kind: "message", role: "assistant", text: "three answer", turnId: "turn-3", markdown: true },
  ];
}

function clientMock() {
  return {
    forkThread: vi.fn().mockResolvedValue({ thread: { id: "forked" } }),
    rollbackThread: vi.fn().mockResolvedValue({ thread: { id: "forked" } }),
    archiveThread: vi.fn().mockResolvedValue({}),
    readThread: vi.fn(),
    setThreadName: vi.fn(),
  };
}

function hostMock({ client, displayItems }: { client: ReturnType<typeof clientMock>; displayItems: DisplayItem[] }) {
  const state = createChatState();
  const stateStore = createChatStateStore({ ...state, displayItems });
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
    notifyThreadArchived: vi.fn(),
    notifyThreadRenamed: vi.fn(),
    notifyActiveThreadIdentityChanged: vi.fn(),
    refreshThreads: vi.fn().mockResolvedValue(undefined),
    refreshSharedThreadListFromOpenSurface: vi.fn(),
    closePanel: vi.fn(),
  } satisfies ChatThreadActionControllerHost;
}
