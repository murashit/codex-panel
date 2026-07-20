// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import { createServerDiagnostics } from "../../../../src/domain/server/diagnostics";
import type { ChatPanelSession } from "../../../../src/features/chat/host/session";
import { deferred, waitForAsyncWork } from "../../../support/async";
import { runtimeConfigFixture } from "../../../support/runtime-config";
import {
  chatHost,
  chatView,
  composerElement,
  connectedClient,
  connectionMockState,
  expectRequestTimes,
  panelThread,
  requestMethods,
  requiredButton,
  resumedThread,
  setupViewConnectionHarness,
  submitComposerByEnter,
  threadFixture,
} from "./view-connection-harness";

describe("CodexChatView workspace restoration", () => {
  setupViewConnectionHarness();

  it("restores workspace thread state without hydrating it automatically", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("thread-1")),
    });
    connectionMockState().client = client;
    const view = await chatView();

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
    expectRequestTimes(client, "thread/list", 1);
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/turns/list");
  });

  it("keeps workspace state readable while detached from an execution runtime", async () => {
    const view = await chatView();
    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    view.detachRuntime();

    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.getDisplayText()).toBe("Restored thread");
    expect(view.isRuntimeAttached()).toBe(false);
    expect(() => view.surface).toThrow("not attached");
  });

  it("closes the session even when runtime snapshot capture fails", async () => {
    const view = await chatView();
    const session = view.surface;
    const close = vi.spyOn(session, "close").mockResolvedValue(undefined);
    vi.spyOn(session as ChatPanelSession, "runtimeSnapshot").mockImplementation(() => {
      throw new Error("snapshot failed");
    });

    expect(() => view.detachRuntime()).toThrow("snapshot failed");
    expect(close).toHaveBeenCalledOnce();
    expect(view.isRuntimeAttached()).toBe(false);
  });

  it("formats the panel title from listed thread metadata", async () => {
    const host = chatHost();
    const view = await chatView({ host });

    await view.setState({ threadId: "thread-named" }, {} as never);
    await view.onOpen();
    host.receiveActiveThreads([panelThread({ id: "thread-named", name: "作業メモ" })]);
    expect(view.getDisplayText()).toBe("Codex: 作業メモ");

    host.receiveActiveThreads([panelThread({ id: "thread-named", name: null, preview: "初回依頼" })]);
    expect(view.getDisplayText()).toBe("Codex: 初回依頼");

    await view.setState({ threadId: "019e061e-0000-7000-8000-000000000001" }, {} as never);
    host.receiveActiveThreads([]);
    expect(view.getDisplayText()).toBe("Codex: 019e061e");
  });

  it("keeps late workspace thread state restored until explicit focus", async () => {
    vi.useFakeTimers();
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView();

    await view.onOpen();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectionMockState().connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expectRequestTimes(client, "thread/list", 1);
    expect(requestMethods(client)).not.toContain("thread/resume");

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);

    expect(view.getDisplayText()).toBe("Codex: Restored thread");
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    expect(requestMethods(client)).not.toContain("thread/resume");
    expect(requestMethods(client)).not.toContain("thread/turns/list");

    await view.surface.focusThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
    );
  });

  it("replaces active thread-scoped state when late workspace state restores another thread", async () => {
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView();

    await view.onOpen();
    await view.surface.openThread("thread-1");
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
    const fetchModels = vi.fn().mockResolvedValue([]);
    connectionMockState().client = client;
    const view = await chatView({ host: chatHost({ fetchModels }) });

    await view.onOpen();

    expect(connectionMockState().connectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMockState().connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expect(fetchModels).toHaveBeenCalledOnce();
    expectRequestTimes(client, "skills/list", 1);
    expectRequestTimes(client, "permissionProfile/list", 1);
    expectRequestTimes(client, "account/rateLimits/read", 1);
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
    const view = await chatView({
      host: chatHost({
        activeSnapshot: vi.fn(() => [cachedThread] as never[]),
        appServerMetadataSnapshot: vi.fn(
          () =>
            ({
              runtimeConfig: { ...runtimeConfigFixture(), model: "gpt-cached" },
              availableSkills: [{ name: "writer", enabled: true }],
              availablePermissionProfiles: [],
              rateLimit: null,
              serverDiagnostics: createServerDiagnostics(),
            }) as never,
        ),
      }),
    });

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
    connectionMockState().client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();

    expect(requestMethods(client)).not.toContain("thread/resume");
    await view.surface.focusThread("thread-1");

    expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    expect(client.request).toHaveBeenCalledWith(
      "thread/turns/list",
      expect.objectContaining({ threadId: "thread-1", cursor: null, limit: 20 }),
    );
  });

  it("starts fresh hydration when the same restored view state is reapplied", async () => {
    const resume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn(() => resume.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();
    const firstHydration = view.surface.focusThread("thread-1");
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "thread/resume", 1);
    });

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    const secondHydration = view.surface.focusThread("thread-1");
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "thread/resume", 2);
    });

    resume.resolve(resumedThread("thread-1"));
    await Promise.all([firstHydration, secondHydration]);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
  });

  it("resumes a restored thread before sending the first message", async () => {
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView();

    await view.setState({ threadId: "thread-1", threadTitle: "Restored thread" }, {} as never);
    await view.onOpen();
    view.surface.setComposerText("hello");
    await submitComposerByEnter(view);

    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
      expect(client.request).toHaveBeenCalledWith("turn/start", {
        threadId: "thread-1",
        cwd: "/vault",
        input: [{ type: "text", text: "hello", text_elements: [] }],
        clientUserMessageId: expect.stringMatching(/^local-user-\d+-[A-Za-z0-9_-]+-[a-z0-9]+$/),
      });
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnBusy: true });
    expect(view.getState()).toEqual({ version: 1, threadId: "thread-1", threadTitle: "Restored thread" });
    connectionMockState().onNotification?.({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
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
    expect(view.surface.openPanelSnapshot()).toMatchObject({ turnBusy: true });
  });

  it("notifies Threads only when panel activity changes", async () => {
    const notifyPanelActivityChanged = vi.fn();
    const client = connectedClient();
    connectionMockState().client = client;
    const view = await chatView({ host: chatHost({ notifyPanelActivityChanged }) });

    await view.onOpen();
    expect(notifyPanelActivityChanged).toHaveBeenCalledOnce();

    await view.surface.openThread("thread-1");
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
        turn: {
          id: "turn-1",
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
        turn: {
          id: "turn-1",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
          error: null,
          itemsView: "full",
          items: [],
        },
      },
    } satisfies Extract<ServerNotification, { method: "turn/completed" }>);
    expect(notifyPanelActivityChanged).toHaveBeenCalledOnce();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1", turnBusy: false, pending: true });
  });
});
