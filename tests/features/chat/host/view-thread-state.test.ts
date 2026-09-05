// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import { deferred, waitForAsyncWork } from "../../../support/async";
import {
  chatHost,
  chatView,
  completedTurn,
  composerElement,
  composerPlaceholder,
  connectedClient,
  connectionMockState,
  expectRequestTimes,
  panelThread,
  requestMethods,
  resumedThread,
  setupViewConnectionHarness,
  turnWithUserMessage,
} from "./view-connection-harness";

describe("CodexChatView thread state", () => {
  setupViewConnectionHarness();

  it("requests a workspace layout save after resuming a thread", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView({ requestSaveLayout });

    await view.surface.activateThread("thread-1");

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(requestSaveLayout).toHaveBeenCalledTimes(1);
  });

  it("does not persist a temporary subagent panel target", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("child", { parentThreadId: "parent", threadSource: "subAgentThreadSpawn" })),
    });
    connectionMockState().client = client;
    const view = await chatView();

    await view.surface.activateThread("child");

    expect(view.getState()).toEqual({ version: 1 });
  });

  it("does not persist a disconnected subagent awaiting resume", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("child", { parentThreadId: "parent", threadSource: "subAgentThreadSpawn" })),
    });
    connectionMockState().client = client;
    const view = await chatView();

    await view.surface.activateThread("child");
    connectionMockState().onExit?.();

    expect(view.getState()).toEqual({ version: 1 });
  });

  it("resumes another persistent thread before unsubscribing a running subagent", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) => {
        const threadId = (params as { threadId: string }).threadId;
        return Promise.resolve(
          threadId === "child"
            ? resumedThread(threadId, { parentThreadId: "parent", threadSource: "subAgentThreadSpawn" })
            : resumedThread(threadId),
        );
      }),
      "thread/unsubscribe": vi.fn().mockResolvedValue({ status: "unsubscribed" }),
    });
    connectionMockState().client = client;
    const view = await chatView();

    await view.surface.activateThread("child");
    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "child",
        turn: {
          id: "turn-child",
          status: "inProgress",
          startedAt: 1,
          completedAt: null,
          durationMs: null,
          error: null,
          itemsView: "full",
          items: [],
        },
      },
    } satisfies Extract<ServerNotification, { method: "turn/started" }>);

    await view.surface.activateThread("other");

    const unsubscribeCall = client.request.mock.calls.findIndex(([method]) => method === "thread/unsubscribe");
    const otherResumeCall = client.request.mock.calls.findIndex(
      ([method, params]) => method === "thread/resume" && (params as { threadId: string }).threadId === "other",
    );
    expect(unsubscribeCall).toBeGreaterThanOrEqual(0);
    expect(unsubscribeCall).toBeGreaterThan(otherResumeCall);
    expect(client.request).not.toHaveBeenCalledWith("turn/interrupt", expect.anything());
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "other" });
  });

  it("keeps a running subagent subscribed when openThread cannot resume the target", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) => {
        const threadId = (params as { threadId: string }).threadId;
        return Promise.resolve(
          threadId === "child" ? resumedThread(threadId, { parentThreadId: "parent", threadSource: "subAgentThreadSpawn" }) : null,
        );
      }),
      "thread/unsubscribe": vi.fn().mockResolvedValue({ status: "unsubscribed" }),
    });
    connectionMockState().client = client;
    const view = await chatView();

    await view.surface.activateThread("child");
    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "child",
        turn: {
          id: "turn-child",
          status: "inProgress",
          startedAt: 1,
          completedAt: null,
          durationMs: null,
          error: null,
          itemsView: "full",
          items: [],
        },
      },
    } satisfies Extract<ServerNotification, { method: "turn/started" }>);

    await view.surface.activateThread("other");

    expect(requestMethods(client).filter((method) => method === "thread/unsubscribe")).toEqual([]);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "child", turnBusy: true });
  });

  it("resets to an unstarted empty chat without starting a thread", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView({ requestSaveLayout });

    await view.surface.activateThread("thread-1");
    const updateHeader = vi.fn();
    Object.assign(view.leaf, { updateHeader });
    await view.surface.startNewThread();

    expect(updateHeader).toHaveBeenCalled();
    expect(view.getDisplayText()).toBe("Codex");

    expect(requestMethods(client)).not.toContain("thread/start");
    expect(view.getState()).toEqual({ version: 1 });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: null, turnBusy: false, hasComposerDraft: false });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("focuses the composer after panel thread actions", async () => {
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView();

    await view.onOpen();
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus").mockImplementation(() => undefined);

    await view.surface.activateThread("thread-1");
    await view.surface.activateThread("thread-1");
    await view.surface.startNewThread();

    expect(focus).toHaveBeenCalledTimes(3);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("clears the active thread when another view archives it", async () => {
    const requestSaveLayout = vi.fn();
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView({ requestSaveLayout });

    await view.surface.activateThread("thread-1");
    view.surface.applyThreadUnavailable("thread-1");

    expect(view.getState()).toEqual({ version: 1 });
    expect(requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it("updates restored panel title from shared rename notifications", async () => {
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Before rename" }, {} as never);
    view.surface.applyThreadRenamed("thread-1", "After rename");

    expect(view.getDisplayText()).toBe("Codex: After rename");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "After rename" });
  });

  it("does not use restored thread identity as a composer name before the thread becomes active", async () => {
    const host = chatHost();
    const view = await chatView({ host });

    await view.setState({ threadId: "thread-1", threadTitle: "Restored title" }, {} as never);
    await view.onOpen();

    expect(composerPlaceholder(view)).toBe("Ask Codex...");

    host.receiveActiveThreads([panelThread({ id: "thread-1", name: "Explicit name" })]);
    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex...");
    });

    view.surface.applyThreadRenamed("thread-1", "Explicit name");

    await waitForAsyncWork(() => {
      expect(composerPlaceholder(view)).toBe("Ask Codex...");
    });
  });

  it("keeps composer draft and selection while updating the placeholder", async () => {
    const client = connectedClient();
    connectionMockState().client = client;
    const host = chatHost();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.activateThread("thread-1");
    view.surface.setComposerText("keep this draft");
    const composer = composerElement(view);
    await waitForAsyncWork(() => {
      expect(composer.value).toBe("keep this draft");
    });
    composer.setSelectionRange(5, 9);

    host.receiveActiveThreads([panelThread({ id: "thread-1", name: "Renamed thread" })]);
    view.surface.applyThreadRenamed("thread-1", "Renamed thread");

    await waitForAsyncWork(() => {
      expect(composer.value).toBe("keep this draft");
      expect(composer.selectionStart).toBe(5);
      expect(composer.selectionEnd).toBe(9);
      expect(composer.getAttribute("placeholder")).toBe("Ask Codex in “Renamed thread”...");
    });
  });

  it("renders resumed thread metadata before history hydration completes", async () => {
    const history = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      "thread/turns/list": vi.fn(() => history.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();

    const opening = view.surface.activateThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith(
        "thread/turns/list",
        expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
      );
    });

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });

    history.resolve({ data: [], nextCursor: null });
    await opening;
  });

  it("hydrates resumed threads from the initial turns page without a second history request", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue({
        ...resumedThread("thread-1"),
        initialTurnsPage: {
          data: [completedTurn("turn-1")],
          nextCursor: "older-cursor",
          backwardsCursor: null,
        },
      }),
      "thread/turns/list": vi.fn().mockResolvedValue({ data: [turnWithUserMessage("fallback prompt")], nextCursor: null }),
    });
    connectionMockState().client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.activateThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    expect(requestMethods(client)).not.toContain("thread/turns/list");
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("hello");
      expect(view.containerEl.textContent).toContain("done");
    });
  });

  it("ignores stale resume results when another thread is opened first", async () => {
    const firstResume = deferred<ReturnType<typeof resumedThread>>();
    const secondResume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) =>
        (params as { threadId: string }).threadId === "thread-1" ? firstResume.promise : secondResume.promise,
      ),
    });
    connectionMockState().client = client;
    const view = await chatView();

    const firstOpen = view.surface.activateThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    });
    const secondOpen = view.surface.activateThread("thread-2");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-2", cwd: "/vault" }));
    });

    secondResume.resolve(resumedThread("thread-2"));
    await secondOpen;
    firstResume.resolve(resumedThread("thread-1"));
    await firstOpen;

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread" });
    expectRequestTimes(client, "thread/turns/list", 1);
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-2", cursor: null, limit: 20 }),
    );
  });

  it("invalidates stale history hydration when a second resume starts", async () => {
    const firstHistory = deferred<{ data: unknown[]; nextCursor: null }>();
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) => Promise.resolve(resumedThread((params as { threadId: string }).threadId))),
      "thread/turns/list": vi.fn((params: unknown) =>
        (params as { threadId: string }).threadId === "thread-1" ? firstHistory.promise : Promise.resolve({ data: [], nextCursor: null }),
      ),
    });
    connectionMockState().client = client;
    const view = await chatView();

    const firstOpen = view.surface.activateThread("thread-1");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith(
        "thread/turns/list",
        expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
      );
    });
    const secondOpen = view.surface.activateThread("thread-2");
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith(
        "thread/turns/list",
        expect.objectContaining({ threadId: "thread-2", cursor: null, limit: 20 }),
      );
    });

    firstHistory.resolve({ data: [turnWithUserMessage("first prompt")], nextCursor: null });
    await firstOpen;
    await secondOpen;

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-2", threadTitle: "Restored thread" });
    expect(view.containerEl.textContent).not.toContain("first prompt");
  });
});
