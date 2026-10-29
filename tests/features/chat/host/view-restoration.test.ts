// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import { createChatState } from "../../../../src/features/chat/application/state/model";
import type { ForkDraftPreparation } from "../../../../src/features/chat/application/threads/fork-draft";
import type { ChatPanelSession } from "../../../../src/features/chat/host/session/session";
import { appServerTurnFixture } from "../../../support/app-server-records";
import { waitForAsyncWork } from "../../../support/async";
import {
  chatHost,
  chatView,
  chatViewForClient,
  chatViewRuntimeOwner,
  completedTurn,
  composerElement,
  connectedClient,
  connectionMockState,
  expectMetadataRequestedOnce,
  expectRequestTimes,
  panelThread,
  requestMethods,
  requiredButton,
  resumedThread,
  runningTurn,
  setupViewConnectionHarness,
  submitComposerByEnter,
  threadFixture,
} from "./view-connection-harness";

describe("CodexChatView workspace restoration", () => {
  setupViewConnectionHarness();

  it("keeps temporary identity and workspace persistence after the first turn fails", async () => {
    const client = connectedClient({
      "thread/start": vi.fn().mockResolvedValue(resumedThread("temporary", { ephemeral: true, name: null, preview: "" })),
      "turn/start": vi.fn().mockRejectedValue(new Error("turn rejected")),
      "turn/interrupt": vi.fn().mockResolvedValue({}),
    });
    connectionMockState().client = client;
    const host = chatHost({ settings: { newConversationsEphemeral: true, showToolbar: false } });
    const view = await chatView({ host });
    await view.onOpen();
    await waitForAsyncWork(() => expect(view.containerEl.querySelector('button[aria-label="Use regular conversation"]')).not.toBeNull());
    view.surface.setComposerText("Keep this conversation");
    await submitComposerByEnter(view);

    await waitForAsyncWork(() => {
      expect(composerElement(view).value).toBe("Keep this conversation");
      expect(view.surface.openPanelSnapshot().threadId).toBe("temporary");
      expect(view.containerEl.querySelector(".codex-panel__conversation-toggle")).toBeNull();
      expect(view.containerEl.querySelector(".codex-panel__conversation-title")?.textContent).toBe("Keep this conversation");
      expect(view.containerEl.querySelector('[aria-label="Temporary conversation"]')).not.toBeNull();
    });
    host.settingsSource.newConversationsEphemeral = false;
    view.surface.refreshSettings();
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.getDisplayText()).toBe("Codex: Keep this conversation");
    await view.onClose();
  });

  it("does not restore a temporary conversation on context replacement", async () => {
    const host = chatHost({ settings: { newConversationsEphemeral: true, showToolbar: false } });
    const owner = chatViewRuntimeOwner(host);
    const client = connectedClient({
      "thread/start": vi.fn().mockResolvedValue(resumedThread("temporary", { ephemeral: true, name: null, preview: "" })),
      "turn/start": vi.fn().mockRejectedValue(new Error("turn rejected")),
    });
    connectionMockState().client = client;
    const view = await chatView({ runtimeOwner: owner });
    await view.onOpen();
    view.surface.setComposerText("Unsent temporary message");
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => expect(view.surface.openPanelSnapshot().threadId).toBe("temporary"));

    const nextClient = connectedClient();
    owner.replace(chatHost(), () => {
      connectionMockState().client = nextClient;
    });
    await waitForAsyncWork(() => expect(composerElement(view).value).toBe(""));
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, hasForkDraft: false });
    expect(requestMethods(nextClient)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/delete");
  });

  it("discards an uncreated fork draft on context replacement", async () => {
    const host = chatHost();
    const owner = chatViewRuntimeOwner(host);
    connectionMockState().client = connectedClient();
    const view = await chatView({ runtimeOwner: owner });
    await view.onOpen();
    const preparation: ForkDraftPreparation = {
      draft: {
        kind: "persistent",
        sourceThreadId: "source",
        boundary: { kind: "through-turn", turnId: "turn-1" },
        replacement: { sourceThreadId: "source", sourceLatestTurnId: "turn-1", saveMarkdown: false },
      },
      runtime: createChatState().runtime,
      display: {
        items: [
          {
            id: "retained-message",
            kind: "dialogue",
            dialogueKind: "assistantResponse",
            role: "assistant",
            text: "Retained history",
            dialogueState: "completed",
            turnId: "turn-1",
          },
        ],
        turnDiffs: new Map([["turn-1", "retained diff"]]),
        historyCursor: "older-page",
      },
    };
    await view.surface.applyForkDraft(preparation);
    expect(view.getDisplayText()).toBe("Fork draft");
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, hasComposerDraft: false, hasForkDraft: true });
    view.surface.setComposerText("Continue this branch");
    const replacementHost = chatHost();
    owner.replace(replacementHost);
    await waitForAsyncWork(() => expect(composerElement(view).value).toBe(""));
    expect(view.getDisplayText()).toBe("Codex");
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, hasForkDraft: false });
    expect(view.getState()).toEqual({ version: 1 });
    expect(requestMethods(connectionMockState().client as ReturnType<typeof connectedClient>)).not.toContain("thread/fork");
  });

  it("restores the created fork without retrying its source archive after context replacement", async () => {
    const owner = chatViewRuntimeOwner(chatHost());
    const client = connectedClient({
      "turn/start": vi.fn().mockRejectedValue(new Error("turn rejected")),
    });
    const view = await chatViewForClient(client, { runtimeOwner: owner });
    await view.onOpen();
    const draft: ForkDraftPreparation["draft"] = {
      kind: "persistent",
      sourceThreadId: "source",
      boundary: { kind: "before-turn", turnId: "source-last" },
      replacement: { sourceThreadId: "source", sourceLatestTurnId: "source-last", saveMarkdown: false },
    };
    await view.surface.applyForkDraft({ draft, runtime: createChatState().runtime, display: { items: [], turnDiffs: new Map() } });
    view.surface.setComposerText("Retry this prompt");
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "turn/start", 1);
      expect(composerElement(view).value).toBe("Retry this prompt");
    });
    const archiveThread = vi.fn().mockResolvedValue({ kind: "archived", exportedPath: null });
    const nextClient = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("thread-forked")),
      "thread/turns/list": vi.fn().mockResolvedValue({ data: [completedTurn("source-last")], nextCursor: null }),
    });
    owner.replace(chatHost({ threadMutations: { archiveThread } }), () => {
      connectionMockState().client = nextClient;
    });
    await waitForAsyncWork(() => expect(composerElement(view).value).toBe(""));
    expect(view.getState()).toMatchObject({ threadId: "thread-forked" });
    await view.surface.activateThread();
    view.surface.setComposerText("Continue fork");
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => expectRequestTimes(nextClient, "turn/start", 1));
    expect(archiveThread).not.toHaveBeenCalled();
    expect(requestMethods(nextClient)).not.toContain("thread/fork");
  });

  it("restores workspace thread state without hydrating it automatically", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("thread-1")),
    });
    const view = await chatViewForClient(client);

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();

    expect(view.getDisplayText()).toBe("Codex: Restored thread");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    expect(connectionMockState().connectCalls).toBe(0);
    expect(requestMethods(client)).not.toContain("thread/resume");

    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMockState().connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expectRequestTimes(client, "thread/list", 2);
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/turns/list");
  });

  it("keeps workspace state readable while detached from an execution runtime", async () => {
    const view = await chatView();
    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.detachRuntime();

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.getDisplayText()).toBe("Restored thread");
    expect(view.isRuntimeAttached()).toBe(false);
    expect(() => view.surface).toThrow("not attached");
  });

  it("removes the open panel's pointer listener when its runtime detaches", async () => {
    const view = await chatView();
    view.load();
    const addListener = vi.spyOn(document, "addEventListener");
    const removeListener = vi.spyOn(document, "removeEventListener");
    try {
      await view.onOpen();
      const pointerListener = addListener.mock.calls.find(([event]) => event === "pointerdown")?.[1];
      expect(pointerListener).toBeTypeOf("function");

      await view.detachRuntime();

      expect(removeListener).toHaveBeenCalledWith("pointerdown", pointerListener, undefined);
    } finally {
      view.unload();
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });

  it("closes the session even when workspace state capture fails", async () => {
    const view = await chatView();
    const session = view.surface;
    const close = vi.spyOn(session, "close").mockResolvedValue(undefined);
    vi.spyOn(session as ChatPanelSession, "persistedState").mockImplementation(() => {
      throw new Error("snapshot failed");
    });

    await expect(view.detachRuntime()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(view.isRuntimeAttached()).toBe(false);
  });

  it("formats the panel title from listed thread metadata", async () => {
    const host = chatHost();
    const view = await chatView({ host });

    await view.setState({ threadId: "thread-named" }, {} as never);
    await view.onOpen();
    host.receiveActiveThreads([panelThread({ id: "thread-named", name: "Work notes" })]);
    expect(view.getDisplayText()).toBe("Codex: Work notes");

    host.receiveActiveThreads([panelThread({ id: "thread-named", name: null, preview: "Initial request" })]);
    expect(view.getDisplayText()).toBe("Codex: Initial request");

    await view.setState({ threadId: "019e061e-0000-7000-8000-000000000001" }, {} as never);
    host.receiveActiveThreads([]);
    expect(view.getDisplayText()).toBe("Codex: 019e061e");
  });

  it("keeps late workspace thread state restored until explicit focus", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    const view = await chatViewForClient(client);

    await view.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectionMockState().connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expectRequestTimes(client, "thread/list", 2);
    expect(requestMethods(client)).not.toContain("thread/resume");

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);

    expect(view.getDisplayText()).toBe("Codex: Restored thread");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/turns/list");

    await view.surface.activateThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }), {
      onResponse: expect.any(Function),
    });
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
    );
  });

  it("replaces active thread-scoped state when late workspace state restores another thread", async () => {
    const client = connectedClient();
    const view = await chatViewForClient(client);

    await view.onOpen();
    await view.surface.activateThread("thread-1");
    view.surface.setComposerText("stale draft");

    await view.setState({ threadId: "thread-2", threadTitle: "Restored thread 2" }, {} as never);

    expect(view.getDisplayText()).toBe("Codex: Restored thread 2");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread 2" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({
      threadId: "thread-2",
      turnBusy: false,
      hasComposerDraft: false,
    });
    expect(composerElement(view).value).toBe("");
  });

  it("warms app-server metadata for an empty restored panel after the shell is open", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      "thread/list": vi.fn().mockResolvedValue({ data: [threadFixture("thread-1")], nextCursor: null }),
    });
    const view = await chatViewForClient(client);

    await view.onOpen();

    expect(connectionMockState().connectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMockState().connectCalls).toBe(1);
    expectMetadataRequestedOnce(client);
    expect(client.request).toHaveBeenCalledWith("thread/list", {
      cwd: "/vault",
      archived: false,
      sortKey: "recency_at",
      sortDirection: "desc",
    });
    requiredButton(view.containerEl, '[aria-label="Show thread list"]').click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Restored thread");
    });
  });

  it("applies cached shared thread list and metadata when opened", async () => {
    const cachedThread = threadFixture("thread-cached");
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { model: "gpt-cached" }, layers: null }),
      "thread/list": vi.fn().mockResolvedValue({ data: [cachedThread], nextCursor: null }),
    });
    connectionMockState().client = client;
    const host = chatHost();
    await Promise.all([host.appServerQueries.ensureAppServerMetadata(), host.threadCatalog.fetchActiveThreads()]);
    const view = await chatView({ host });

    await view.onOpen();

    requiredButton(view.containerEl, '[aria-label="Show thread list"]').click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Restored thread");
    });
    requiredButton(view.containerEl, '[aria-label="Show status"]').click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("gpt-cached");
    });
  });

  it("hydrates a focused restored thread immediately", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    const view = await chatViewForClient(client);

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();

    expect(requestMethods(client)).not.toContain("thread/resume");
    await view.surface.activateThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }), {
      onResponse: expect.any(Function),
    });
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
    );
  });

  it("resumes a restored thread before sending the first message", async () => {
    const client = connectedClient();
    const view = await chatViewForClient(client);

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();
    view.surface.setComposerText("hello");
    await submitComposerByEnter(view);

    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }), {
        onResponse: expect.any(Function),
      });
      expect(client.request).toHaveBeenCalledWith("turn/start", {
        threadId: "thread-1",
        cwd: "/vault",
        input: [{ type: "text", text: "hello", text_elements: [] }],
        clientUserMessageId: expect.any(String),
      });
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnBusy: true });
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: runningTurn("turn-1"),
      },
    } satisfies Extract<ServerNotification, { method: "turn/started" }>);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnBusy: true });
  });

  it("notifies Threads only when panel activity changes", async () => {
    const notifyPanelActivityChanged = vi.fn();
    const client = connectedClient();
    const view = await chatViewForClient(client, { host: chatHost({ notifyPanelActivityChanged }) });

    await view.onOpen();
    expect(notifyPanelActivityChanged).toHaveBeenCalledOnce();

    await view.surface.activateThread("thread-1");
    notifyPanelActivityChanged.mockClear();

    view.surface.setComposerText("hello");
    expect(notifyPanelActivityChanged).not.toHaveBeenCalled();

    await submitComposerByEnter(view);
    expect(notifyPanelActivityChanged).toHaveBeenCalledOnce();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1", turnBusy: true, pending: false });

    notifyPanelActivityChanged.mockClear();
    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: runningTurn("turn-1"),
      },
    } satisfies Extract<ServerNotification, { method: "turn/started" }>);
    expect(notifyPanelActivityChanged).not.toHaveBeenCalled();

    connectionMockState().onServerRequest?.(
      {
        id: 7,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "input-1",
          questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
          isBlocking: true,
          autoResolutionMs: null,
        },
      },
      { respond: vi.fn(), reject: vi.fn() },
    );
    expect(notifyPanelActivityChanged).toHaveBeenCalledOnce();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1", turnBusy: true, pending: true });

    notifyPanelActivityChanged.mockClear();
    connectionMockState().onNotification?.({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: appServerTurnFixture({
          id: "turn-1",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          itemsView: "full",
          items: [],
        }),
      },
    } satisfies Extract<ServerNotification, { method: "turn/completed" }>);
    expect(notifyPanelActivityChanged).toHaveBeenCalledOnce();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1", turnBusy: false, pending: true });
  });
});
