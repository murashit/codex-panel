// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import { AppServerQueryScope } from "../../../../src/app-server/query/query-scope";
import { AppServerToolInventoryQueries } from "../../../../src/app-server/query/tool-inventory-queries";
import { sideChatDraft } from "../../../../src/features/chat/application/threads/fork-draft";
import type { ThreadGoal } from "../../../../src/generated/app-server/v2/ThreadGoal";
import { notices } from "../../../mocks/obsidian";
import { appServerTurnFixture } from "../../../support/app-server-records";
import { deferred, waitForAsyncWork } from "../../../support/async";
import {
  chatHost,
  chatView,
  chatViewForClient,
  chatViewRuntimeOwner,
  completedTurn,
  connectedClient,
  connectionMockState,
  expectMetadataRequestedOnce,
  expectRequestTimes,
  openedChatView,
  requestMethods,
  requiredButton,
  requiredTextArea,
  resumedThread,
  setupViewConnectionHarness,
  submitComposerByEnter,
  threadFixture,
} from "./view-connection-harness";

describe("CodexChatView connection lifecycle", () => {
  setupViewConnectionHarness();

  it("projects official receipts through panel snapshots and acknowledges foreground activation", async () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const markRead = vi.fn().mockResolvedValue({ readState: { revision: "read", firstUnread: null } });
    const client = connectedClient({
      "thread/read": vi.fn().mockResolvedValue({ thread: threadFixture("thread-1"), readState: { revision: "read", firstUnread: null } }),
      "thread/readState/update": markRead,
    });
    const view = await openedChatView(client);
    await view.surface.activateThread("thread-1", { focus: false });
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/read", 1));

    // Goal and lifecycle events never manufacture unread; Codex's receipt policy owns eligibility.
    connectionMockState().onNotification?.({
      method: "thread/goal/updated",
      params: {
        threadId: "thread-1",
        turnId: null,
        goal: goalSnapshot("Keep working", 1),
      },
    });
    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: appServerTurnFixture({ id: "goal-turn", status: "inProgress", items: [], itemsView: "full" }),
      },
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnBusy: true, unread: false });
    connectionMockState().onNotification?.({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: appServerTurnFixture({ id: "goal-turn", status: "completed", items: [], itemsView: "full" }),
      },
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnBusy: false, unread: false });

    connectionMockState().onNotification?.({
      method: "thread/readState/changed",
      params: {
        threadId: "thread-1",
        readState: { revision: "unseen", firstUnread: { type: "turn", turnId: "goal-turn" } },
      },
    });
    expect(view.surface.openPanelSnapshot().unread).toBe(true);
    expect(markRead).not.toHaveBeenCalled();
    focus.mockReturnValue(true);
    const activeLeafChanged = (view.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls
      .slice()
      .reverse()
      .find(([name]) => name === "active-leaf-change")?.[1];
    activeLeafChanged();
    expect(markRead).toHaveBeenCalledExactlyOnceWith(
      { threadId: "thread-1", expectedRevision: "unseen", operation: { type: "read" } },
      undefined,
    );
    await waitForAsyncWork(() => expect(view.surface.openPanelSnapshot().unread).toBe(false));

    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const popout = frame.contentWindow;
    if (!popout) throw new Error("Expected popout window");
    popout.document.body.appendChild(view.containerEl);
    const popoutFocus = vi.spyOn(popout.document, "hasFocus").mockReturnValue(false);
    vi.spyOn(popout.document, "visibilityState", "get").mockReturnValue("visible");
    const layoutChanged = (view.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls
      .slice()
      .reverse()
      .find(([name]) => name === "layout-change")?.[1];
    layoutChanged();
    connectionMockState().onNotification?.({
      method: "thread/readState/changed",
      params: {
        threadId: "thread-1",
        readState: { revision: "next", firstUnread: { type: "turn", turnId: "next-turn" } },
      },
    });
    expect(markRead).toHaveBeenCalledTimes(1);
    popoutFocus.mockReturnValue(true);
    popout.dispatchEvent(new Event("focus"));
    await waitForAsyncWork(() => expect(markRead).toHaveBeenCalledTimes(2));
    const surface = view.surface;
    await view.onClose();
    expect(surface.openPanelSnapshot().threadId).toBeNull();
  });

  it("restores a warm running Plan turn before coalesced replay and keeps its live result", async () => {
    const response = deferred<unknown>();
    const turn = appServerTurnFixture({
      id: "running",
      status: "inProgress",
      itemsView: "full",
      items: [
        {
          type: "agentMessage",
          id: "answer",
          text: "Snapshot",
          phase: "final_answer",
          memoryCitation: null,
          delivery: null,
          questions: null,
        },
      ],
    });
    let receiveResponse: (value: unknown) => void = () => {
      throw new Error("Expected pending resume");
    };
    const client = connectedClient({
      "thread/resume": vi.fn((_params, options) => {
        receiveResponse = (options as { onResponse: (value: unknown) => void }).onResponse;
        return response.promise;
      }),
    });
    const view = await openedChatView(client);
    const opening = view.surface.activateThread("thread-1", { focus: false });
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/resume", 1));
    // App-server sends the snapshot before replay, without a turn/started notification.
    connectionMockState().onNotification?.({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "running", itemId: "answer", delta: "Snapshot" },
    });
    const snapshot = {
      ...resumedThread("thread-1"),
      collaborationMode: { mode: "plan", settings: { model: "gpt-test", reasoning_effort: null, developer_instructions: null } },
      initialTurnsPage: { data: [turn], nextCursor: null, backwardsCursor: null },
    };
    receiveResponse(snapshot);
    response.resolve(snapshot);
    connectionMockState().onNotification?.({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "running", itemId: "answer", delta: " plus live" },
    });
    const responder = { respond: vi.fn(), reject: vi.fn() };
    connectionMockState().onServerRequest?.(
      {
        id: 901,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-1",
          turnId: "running",
          itemId: "question",
          isBlocking: true,
          autoResolutionMs: null,
          questions: [{ id: "next", header: "Next", question: "What now?", isOther: false, isSecret: false, options: null }],
        },
      },
      responder,
    );
    await opening;
    await waitForAsyncWork(() => {
      expect(view.surface.openPanelSnapshot()).toMatchObject({ turnBusy: true, pending: true });
      expect(view.containerEl.textContent).toContain("Snapshot plus live");
      expect(view.containerEl.textContent).toContain("What now?");
      expect(view.containerEl.querySelector(".codex-panel__composer-meta-summary")?.textContent).toContain("plan on");
      expect(view.containerEl.querySelector('[aria-label="Interrupt"]')).not.toBeNull();
    });
    expect(responder.reject).not.toHaveBeenCalled();
    expectRequestTimes(client, "thread/turns/list", 0);
    connectionMockState().onNotification?.({ method: "serverRequest/resolved", params: { threadId: "thread-1", requestId: 901 } });
    await waitForAsyncWork(() => expect(view.surface.openPanelSnapshot().pending).toBe(false));
    requiredButton(view.containerEl, '[aria-label="Interrupt"]').click();
    await waitForAsyncWork(() =>
      expect(client.request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread-1", turnId: "running" }),
    );
    connectionMockState().onNotification?.({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: appServerTurnFixture({
          ...turn,
          status: "completed",
          items: [
            {
              type: "agentMessage",
              id: "answer",
              text: "Final result",
              phase: "final_answer",
              memoryCitation: null,
              delivery: null,
              questions: null,
            },
          ],
        }),
      },
    });
    await waitForAsyncWork(() => {
      expect(view.surface.openPanelSnapshot().turnBusy).toBe(false);
      expect(view.containerEl.textContent).toContain("Final result");
      expect(view.containerEl.textContent).not.toContain("Snapshot plus live");
    });
    view.surface.setComposerText("Continue in Plan");
    submitComposerByEnter(view);
    await waitForAsyncWork(() => expectRequestTimes(client, "turn/start", 1));
    expect(requestMethods(client)).not.toContain("thread/settings/update");
  });

  it("shares post-initialize metadata loading across concurrent connect calls", async () => {
    const client = connectedClient();
    const view = await chatViewForClient(client);

    await Promise.all([view.surface.connect(), view.surface.connect()]);

    expect(connectionMockState().connectCalls).toBe(1);
    expectMetadataRequestedOnce(client);
    expectRequestTimes(client, "thread/list", 2);
  });

  it("resumes while metadata is still loading without reconnecting", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn(() => config.promise),
    });
    const view = await chatViewForClient(client);

    const opening = view.surface.activateThread("thread-1");
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "config/read", 1);
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }), {
        onResponse: expect.any(Function),
      });
    });
    await opening;
    let connected = false;
    const fullyConnected = view.surface.connect().then(() => {
      connected = true;
    });
    await Promise.resolve();

    expect(connectionMockState().connected).toBe(true);
    expect(connectionMockState().connectCalls).toBe(1);
    expect(connected).toBe(false);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });

    config.resolve({});
    await fullyConnected;
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "thread/list", 2);
    });

    expectRequestTimes(client, "config/read", 1);
  });

  it("keeps the latest explicit target when an older activation finishes later", async () => {
    const { client, delayed } = delayedThreadResumeClient("thread-b");
    const view = await chatViewForClient(client);
    await view.surface.activateThread("thread-a", { focus: false });

    const openingB = view.surface.activateThread("thread-b", { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-b", cwd: "/vault" }), {
        onResponse: expect.any(Function),
      });
    });
    await view.surface.activateThread("thread-a", { focus: false });
    delayed.resolve(resumedThread("thread-b"));
    await openingB;

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-a");
  });

  it("settles repeated selections on the requested target", async () => {
    const history = deferred<{ data: []; nextCursor: null }>();
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("thread-a")),
      "thread/turns/list": vi.fn(() => history.promise),
    });
    const view = await chatViewForClient(client);

    const opening = view.surface.activateThread("thread-a", { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/turns/list", expect.objectContaining({ threadId: "thread-a" }));
    });
    const reselecting = view.surface.activateThread("thread-a", { focus: false });

    history.resolve({ data: [], nextCursor: null });
    await Promise.all([opening, reselecting]);

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-a");
  });

  it("keeps the current thread and draft when another thread cannot be resumed", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn((params) => {
        const { threadId } = params as { threadId: string };
        return threadId === "thread-b" ? Promise.reject(new Error("Resume failed")) : Promise.resolve(resumedThread(threadId));
      }),
    });
    const view = await openedChatView(client);
    await view.surface.activateThread("thread-a", { focus: false });
    view.surface.setComposerText("Keep this draft");

    await view.surface.activateThread("thread-b", { focus: false });

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-a");
    expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Keep this draft");
  });

  it("does not replace explicit navigation with a passive panel focus", async () => {
    const { client, delayed } = delayedThreadResumeClient("thread-b");
    const view = await chatViewForClient(client);
    await view.surface.activateThread("thread-a", { focus: false });

    const openingB = view.surface.activateThread("thread-b", { focus: false });
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/resume", 2));
    await view.surface.activateThread(undefined, { focus: false });
    delayed.resolve(resumedThread("thread-b"));
    await openingB;

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-b");
  });

  it("keeps the newest target when another activation starts during adoption", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn((params) => Promise.resolve(resumedThread((params as { threadId: string }).threadId))),
    });
    connectionMockState().client = client;
    let view: Awaited<ReturnType<typeof chatView>>;
    let newerActivation: Promise<boolean> | null = null;
    const notifyPanelActivityChanged = vi.fn(() => {
      if (newerActivation || view?.surface.openPanelSnapshot().threadId !== "thread-b") return;
      newerActivation = view.surface.activateThread("thread-c", { focus: false });
    });
    view = await chatView({ host: chatHost({ notifyPanelActivityChanged }) });
    await view.onOpen();
    await view.surface.activateThread("thread-a", { focus: false });

    await view.surface.activateThread("thread-b", { focus: false });
    await newerActivation;

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-c");
    expect(client.request).not.toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread-c" }, expect.anything());
  });

  it("restores the thread without its draft after context replacement", async () => {
    const owner = chatViewRuntimeOwner(chatHost());
    connectionMockState().client = connectedClient();
    const view = await chatView({ runtimeOwner: owner });
    await view.onOpen();
    await view.surface.connect();
    await view.surface.activateThread("thread-1");
    view.surface.setComposerText("Keep this draft");

    const nextHost = chatHost();
    nextHost.settingsSource.codexPath = "codex-next";
    const resumed = deferred<ReturnType<typeof resumedThread>>();
    const nextClient = connectedClient({
      "thread/resume": vi.fn(() => resumed.promise),
    });
    owner.replace(nextHost, () => {
      connectionMockState().client = nextClient;
    });

    expect(requestMethods(nextClient)).not.toContain("thread/resume");
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    await waitForAsyncWork(() => {
      expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("");
    });

    view.surface.setComposerText("Edited while reconnecting");

    const restoring = view.surface.activateThread();
    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }), {
        onResponse: expect.any(Function),
      });
    });
    resumed.resolve(resumedThread("thread-1"));
    await restoring;

    await waitForAsyncWork(() => {
      expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Edited while reconnecting");
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("returns from a replacement draft without creating or archiving a thread", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn((params) => {
        const { threadId } = params as { threadId: string };
        return Promise.resolve({
          ...resumedThread(threadId),
          initialTurnsPage: {
            data: [completedTurn("turn-1")],
            nextCursor: null,
            backwardsCursor: null,
          },
        });
      }),
    });
    const view = await openedChatView(client);
    await view.surface.activateThread("thread-1", { focus: false });

    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__fork-dialogue")).not.toBeNull();
    });
    requiredButton(view.containerEl, ".codex-panel__fork-dialogue").click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__fork-and-archive-dialogue")).not.toBeNull();
    });
    requiredButton(view.containerEl, ".codex-panel__fork-and-archive-dialogue").click();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, hasForkDraft: true });
    expect(requestMethods(client)).not.toContain("thread/fork");
    await view.surface.activateThread("thread-1", { focus: false });

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-1");
    expect(requestMethods(client)).not.toContain("thread/archive");
  });

  it("does not restore a preserved draft into a different explicit target", async () => {
    const owner = chatViewRuntimeOwner(chatHost());
    connectionMockState().client = connectedClient();
    const view = await chatView({ runtimeOwner: owner });
    await view.onOpen();
    await view.surface.activateThread("thread-a");
    view.surface.setComposerText("Thread A draft");

    const nextClient = connectedClient({
      "thread/resume": vi.fn((params) => Promise.resolve(resumedThread((params as { threadId: string }).threadId))),
    });
    owner.replace(chatHost(), () => {
      connectionMockState().client = nextClient;
    });

    await view.surface.activateThread("thread-b");

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-b");
    expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("");
  });

  it("drops a side chat on context replacement", async () => {
    const owner = chatViewRuntimeOwner(chatHost());
    const firstClient = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi
        .fn()
        .mockResolvedValue({ thread: threadFixture("ephemeral-a"), model: "independent-side-model", reasoningEffort: "high" }),
      "thread/unsubscribe": vi.fn().mockResolvedValue({}),
    });
    connectionMockState().client = firstClient;
    const view = await chatView({ runtimeOwner: owner });
    await view.onOpen();
    await view.surface.connect();
    await view.surface.applyForkDraft(sideChatDraft("source", "Source"), "First message");
    view.surface.setComposerText("Side draft");

    const nextHost = chatHost();
    nextHost.settingsSource.codexPath = "codex-next";
    const nextClient = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("ephemeral-b") }),
    });
    owner.replace(nextHost, () => {
      connectionMockState().client = nextClient;
    });

    await waitForAsyncWork(() =>
      expect(firstClient.request).toHaveBeenCalledWith(
        "thread/unsubscribe",
        { threadId: "ephemeral-a" },
        expect.objectContaining({ timeoutMs: 5_000 }),
      ),
    );

    await waitForAsyncWork(() => {
      expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, hasForkDraft: false });
      expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("");
    });
    expectRequestTimes(nextClient, "thread/fork", 0);
  });

  it("does not read unsupported goals for side chats", async () => {
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("ephemeral-a") }),
      "thread/goal/get": vi.fn().mockRejectedValue(new Error("ephemeral goals are unsupported")),
    });
    const view = await openedChatView(client);

    await view.surface.applyForkDraft(sideChatDraft("source", "Source"), "First message");
    await waitForAsyncWork(() => {
      expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "ephemeral-a" });
    });

    expectRequestTimes(client, "thread/goal/get", 0);
    expect(view.containerEl.querySelector(".codex-panel__goal-load-error")).toBeNull();
  });

  it.each(["draft", "active"] as const)("blocks changing a busy side chat to a %s target", async (target) => {
    const client = connectedClient({
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("side") }),
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("other")),
    });
    const view = await openedChatView(client);
    await view.surface.applyForkDraft(sideChatDraft("source", "Source"), "First message");
    expect(view.surface.openPanelSnapshot().turnBusy).toBe(true);
    const switching =
      target === "draft" ? view.surface.applyForkDraft(sideChatDraft("another", "Another")) : view.surface.activateThread("other");
    await expect(switching).resolves.toBe(false);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "side", turnBusy: true, hasForkDraft: false });
    expectRequestTimes(client, "thread/unsubscribe", 0);
    expectRequestTimes(client, "turn/interrupt", 0);
  });

  it("keeps the current conversation when New chat is requested during turn startup", async () => {
    const started = deferred<{ turn: { id: string } }>();
    const client = connectedClient({
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("side") }),
      "turn/start": vi.fn(() => started.promise),
    });
    const view = await openedChatView(client);
    const opening = view.surface.applyForkDraft(sideChatDraft("source", "Source"), "First message");
    await waitForAsyncWork(() => expectRequestTimes(client, "turn/start", 1));
    await view.surface.startNewThread();
    expect(view.surface.openPanelSnapshot().threadId).toBe("side");
    started.resolve({ turn: { id: "turn" } });
    await expect(opening).resolves.toBe(true);
    expectRequestTimes(client, "thread/unsubscribe", 0);
    expectRequestTimes(client, "turn/interrupt", 0);
  });

  it("keeps a late MCP inventory read scoped to its original thread", async () => {
    const threadA = deferred<{ data: ReturnType<typeof mcpStatus>[]; nextCursor: null }>();
    const threadB = deferred<{ data: ReturnType<typeof mcpStatus>[]; nextCursor: null }>();
    const mcpServers = vi.fn((params?: unknown) =>
      (params as { threadId?: string } | undefined)?.threadId === "thread-a" ? threadA.promise : threadB.promise,
    );
    const client = connectedClient({
      "thread/resume": vi.fn((params?: unknown) => resumedThread((params as { threadId: string }).threadId)),
      "mcpServerStatus/list": mcpServers,
    });
    connectionMockState().client = client;
    const toolInventoryQueries = new AppServerToolInventoryQueries(
      new AppServerQueryScope(
        { codexPath: "codex", vaultPath: "/vault" },
        {
          withClient: async (operation) => operation(client as never),
        },
      ),
    );
    const view = await chatView({ host: chatHost({ toolInventoryQueries }) });
    await view.onOpen();
    await view.surface.activateThread("thread-a", { focus: false });
    requiredButton(view.containerEl, '[aria-label="Show status"]').click();
    await waitForAsyncWork(() => expect(view.containerEl.querySelector('[aria-label="Hide status"]')).not.toBeNull());
    await waitForAsyncWork(() => expect(mcpServers).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-a" }), undefined));

    const openingB = view.surface.activateThread("thread-b", { focus: false });
    await openingB;
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Show status"]')?.click();
    await waitForAsyncWork(() => expect(mcpServers).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-b" }), undefined));
    threadB.resolve({ data: [mcpStatus("thread-b-server")], nextCursor: null });
    await waitForAsyncWork(() => expect(view.containerEl.textContent).toContain("thread-b-server"));

    threadA.resolve({ data: [mcpStatus("thread-a-server")], nextCursor: null });
    await Promise.resolve();
    expect(view.containerEl.textContent).not.toContain("thread-a-server");
  });

  it("closes a completed side chat without treating its terminal turn as active", async () => {
    const client = connectedClient({
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("side") }),
      "turn/interrupt": vi.fn(async (params) => {
        if ((params as { turnId: string }).turnId) throw new Error("no active turn to interrupt");
        return {};
      }),
    });
    const view = await openedChatView(client);
    await view.surface.applyForkDraft(sideChatDraft("source", "Source"), "First message");
    connectionMockState().onNotification?.({
      method: "turn/completed",
      params: { threadId: "side", turn: completedTurn("turn-1") },
    } as ServerNotification);
    await view.onClose();
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/unsubscribe", 1));
    expectRequestTimes(client, "turn/interrupt", 0);
  });

  it("settles a pending side chat request when its view closes", async () => {
    const fork = deferred<{ thread: ReturnType<typeof threadFixture> }>();
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn(() => fork.promise),
    });
    const view = await openedChatView(client);

    const opening = view.surface.applyForkDraft(sideChatDraft("source", "Source"), "First message");
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/fork", 1));
    await view.onClose();
    fork.reject(new Error("Codex app-server disconnected."));

    await expect(opening).resolves.toBe(false);
  });

  it.each(["Explain this briefly", "/clear [[Note]] @active"])("sends literal side-chat input: %s", async (initialMessage) => {
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("side") }),
    });
    const view = await openedChatView(client);

    await view.surface.applyForkDraft(sideChatDraft("source", "Source"), initialMessage);

    expect(client.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        threadId: "side",
        input: [expect.objectContaining({ type: "text", text: initialMessage })],
      }),
    );
  });

  it.each(["", "Next draft"])("restores failed side-chat input alongside the next draft %j", async (nextDraft) => {
    const turn = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("side") }),
      "turn/start": vi.fn(() => turn.promise),
    });
    const view = await openedChatView(client);
    const opening = view.surface.applyForkDraft(sideChatDraft("source", "Source"), "First message");
    await waitForAsyncWork(() => expectRequestTimes(client, "turn/start", 1));
    const input = requiredTextArea(view.containerEl, ".codex-panel__composer-input");
    expect(input.disabled).toBe(false);
    input.value = nextDraft;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    turn.reject(new Error("offline"));
    await expect(opening).resolves.toBe(false);
    expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe(
      nextDraft ? `First message\n\n${nextDraft}` : "First message",
    );
  });

  it("opens a local side-chat draft and creates the latest source fork on first send", async () => {
    const fork = deferred<{ thread: ReturnType<typeof threadFixture> }>();
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn(() => fork.promise),
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("source")),
    });
    connectionMockState().client = client;
    const host = chatHost();
    const source = await chatView({ host });
    await source.onOpen();
    await source.surface.activateThread("source");
    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "source",
        turn: appServerTurnFixture({
          id: "parent-turn",
          status: "inProgress",
          startedAt: 1,
          itemsView: "full",
          items: [],
        }),
      },
    });
    expect(source.surface.openPanelSnapshot().turnBusy).toBe(true);

    const view = await chatView();
    await view.onOpen();
    vi.mocked(host.workspace.openForkDraft).mockImplementation(async (preparation) => {
      await view.surface.applyForkDraft(preparation);
    });
    requiredButton(source.containerEl, '[aria-label="Show chat actions"]').click();
    await waitForAsyncWork(() => expect(source.containerEl.textContent).toContain("Start side chat"));
    const start = [...source.containerEl.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")].find(
      (button) => button.textContent === "Start side chat",
    );
    expect(start?.classList.contains("is-disabled")).toBe(false);
    start?.click();
    await waitForAsyncWork(() => expect(view.surface.openPanelSnapshot().hasForkDraft).toBe(true));
    expectRequestTimes(client, "thread/fork", 0);
    expect(view.getDisplayText()).toBe("Side chat");
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, hasForkDraft: true });

    view.surface.setComposerText("First message");
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/fork", 1));
    expect(client.request).toHaveBeenCalledWith(
      "thread/fork",
      expect.objectContaining({
        threadId: "source",
        ephemeral: true,
        excludeTurns: true,
      }),
    );
    const forkParams = client.request.mock.calls.find(([method]) => method === "thread/fork")?.[1];
    expect(forkParams).not.toHaveProperty("lastTurnId");
    expect(forkParams).not.toHaveProperty("beforeTurnId");
    expect(forkParams).not.toHaveProperty("deferGoalContinuation");
    fork.resolve({ thread: threadFixture("side") });
    await waitForAsyncWork(() => expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "side", hasForkDraft: false }));
  });

  it("starts an empty thread when saving a toolbar goal from a blank panel", async () => {
    vi.useFakeTimers();
    const goal = {
      threadId: "thread-new",
      objective: "Ship the feature",
      status: "active" as const,
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const start = deferred<{ thread: ReturnType<typeof threadFixture> }>();
    const client = connectedClient({
      "thread/start": vi.fn(() => start.promise),
      "thread/goal/set": vi.fn().mockResolvedValue({ goal }),
    });
    const view = await openedChatView(client);
    view.surface.setComposerText("Keep my unsent prompt");

    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Show chat actions"]')?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Set goal...");
    });
    [...view.containerEl.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")]
      .find((item) => item.textContent === "Set goal...")
      ?.click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__goal-objective-input")).not.toBeNull();
    });
    const input = requiredTextArea(view.containerEl, ".codex-panel__goal-objective-input");
    input.value = "Ship the feature";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForAsyncWork(() => {
      const save = view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Save goal"]');
      expect(save?.disabled).toBe(false);
    });
    const save = requiredButton(view.containerEl, '[aria-label="Save goal"]');
    save.click();
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/start", 1));
    save.click();
    await vi.advanceTimersByTimeAsync(0);
    expectRequestTimes(client, "thread/start", 1);
    start.resolve({ thread: threadFixture("thread-new") });

    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/start", {
        cwd: "/vault",
        dynamicTools: expect.any(Array),
        historyMode: "paginated",
        serviceName: "codex-panel",
      });
      expect(client.request).toHaveBeenCalledWith("thread/goal/set", {
        origin: "user",
        threadId: "thread-new",
        objective: "Ship the feature",
        status: "active",
        tokenBudget: null,
      });
    });
    expectRequestTimes(client, "thread/start", 1);
    expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Keep my unsent prompt");
    expect(client.request).not.toHaveBeenCalledWith("thread/inject_items", expect.anything());
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-new" });
    connectionMockState().onNotification?.({
      method: "thread/goal/updated",
      params: { threadId: "thread-new", turnId: null, goal },
    });
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Ship the feature");
      expect(view.containerEl.querySelector(".codex-panel__stream-summary")?.textContent).toBe("set: Ship the feature");
    });
  });

  it("keeps the active thread visible when its initial goal read fails", async () => {
    const client = connectedClient({
      "thread/goal/get": vi.fn().mockRejectedValue(new Error("goal unavailable")),
    });
    const view = await openedChatView(client);

    await view.surface.activateThread("thread-1", { focus: false });
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__goal-load-error")?.textContent).toContain("goal unavailable");
    });

    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
  });

  it("keeps a goal update notification over an earlier in-flight goal read", async () => {
    const { client, oldRead } = pendingGoalReadClient();
    const view = await openedChatView(client);

    const opening = view.surface.activateThread("thread-1", { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/goal/get", { threadId: "thread-1" });
    });
    connectionMockState().onNotification?.({
      method: "thread/goal/updated",
      params: {
        threadId: "thread-1",
        turnId: null,
        goal: goalSnapshot("Latest", 2),
      },
    } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Latest");
    });

    oldRead.resolve({ goal: goalSnapshot("Old", 1) });
    await opening;

    expect(view.containerEl.textContent).toContain("Latest");
    expect(view.containerEl.textContent).not.toContain("Old");
  });

  it("keeps a goal notification when the canceled read later rejects", async () => {
    const { client, oldRead } = pendingGoalReadClient();
    const view = await openedChatView(client);

    const opening = view.surface.activateThread("thread-1", { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/goal/get", { threadId: "thread-1" });
    });
    connectionMockState().onNotification?.({
      method: "thread/goal/updated",
      params: { threadId: "thread-1", turnId: null, goal: goalSnapshot("Latest", 2) },
    } satisfies Extract<ServerNotification, { method: "thread/goal/updated" }>);
    oldRead.reject(new Error("stale read failed"));
    await opening;
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Latest");
    });

    expect(view.containerEl.querySelector(".codex-panel__goal-load-error")).toBeNull();
  });

  it("keeps a goal clear notification over an earlier in-flight goal read", async () => {
    const { client, oldRead } = pendingGoalReadClient();
    const view = await openedChatView(client);

    const opening = view.surface.activateThread("thread-1", { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/goal/get", { threadId: "thread-1" });
    });
    connectionMockState().onNotification?.({
      method: "thread/goal/cleared",
      params: { threadId: "thread-1" },
    } satisfies Extract<ServerNotification, { method: "thread/goal/cleared" }>);

    oldRead.resolve({ goal: goalSnapshot("Old", 1) });
    await opening;

    expect(view.containerEl.querySelector(".codex-panel__goal")).toBeNull();
    expect(view.containerEl.textContent).not.toContain("Old");
  });

  it("ignores stale connection work after the view closes", async () => {
    let resolveConfig!: (value: unknown) => void;
    const client = connectedClient({
      "config/read": vi.fn(
        () =>
          new Promise((resolve) => {
            resolveConfig = resolve;
          }),
      ),
    });
    const view = await chatViewForClient(client);

    const connecting = view.surface.connect();
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "config/read", 1);
    });
    await view.onClose();
    resolveConfig({});
    await connecting;

    expect(notices).toEqual([]);
    expect(requestMethods(client)).not.toContain("thread/list");
  });

  it("notifies Threads immediately and after the workspace settles when the panel closes", async () => {
    const notifyPanelActivityChanged = vi.fn();
    connectionMockState().client = connectedClient();
    const view = await chatView({ host: chatHost({ notifyPanelActivityChanged }) });

    await view.onOpen();
    await view.surface.activateThread("thread-1");
    notifyPanelActivityChanged.mockClear();
    await view.onClose();

    expect(notifyPanelActivityChanged).toHaveBeenCalledOnce();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(notifyPanelActivityChanged).toHaveBeenCalledTimes(2);

    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: appServerTurnFixture({
          id: "late-turn",
          status: "inProgress",
          startedAt: 1,
          itemsView: "full",
          items: [],
        }),
      },
    } satisfies Extract<ServerNotification, { method: "turn/started" }>);
    expect(notifyPanelActivityChanged).toHaveBeenCalledTimes(2);
  });

  it("ignores stale connection work after the app-server exits during metadata loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn(() => config.promise),
    });
    const view = await chatViewForClient(client);

    const connecting = view.surface.connect();
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "config/read", 1);
    });
    connectionMockState().connected = false;
    connectionMockState().onExit?.();

    config.resolve({});
    await connecting;

    expect(requestMethods(client)).not.toContain("thread/list");
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: false });
  });
});

function goalSnapshot(objective: string, updatedAt: number): ThreadGoal {
  return {
    threadId: "thread-1",
    objective,
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt,
  };
}

function mcpStatus(name: string) {
  return {
    name,
    tools: {},
    resources: [],
    resourceTemplates: [],
    authStatus: "oAuth" as const,
    runtimeStatus: "connected" as const,
  };
}

function delayedThreadResumeClient(delayedThreadId: string) {
  const delayed = deferred<ReturnType<typeof resumedThread>>();
  const client = connectedClient({
    "thread/resume": vi.fn((params) => {
      const { threadId } = params as { threadId: string };
      return threadId === delayedThreadId ? delayed.promise : Promise.resolve(resumedThread(threadId));
    }),
  });
  return { client, delayed };
}

function pendingGoalReadClient() {
  const oldRead = deferred<{ goal: ThreadGoal | null }>();
  const client = connectedClient({ "thread/goal/get": vi.fn(() => oldRead.promise) });
  return { client, oldRead };
}
