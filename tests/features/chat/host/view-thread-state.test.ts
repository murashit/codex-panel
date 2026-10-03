// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../../src/app-server/connection/client";
import type { ConnectionManagerHandlers } from "../../../../src/app-server/connection/connection-manager";
import { AppServerContextConnection } from "../../../../src/app-server/connection/context-connection";
import type { ServerNotification, ServerRequest } from "../../../../src/app-server/connection/rpc-messages";
import { createChatState } from "../../../../src/features/chat/application/state/model";
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
  runningTurn,
  setupViewConnectionHarness,
  threadFixture,
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

  it("does not persist a subagent target before or after disconnection", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn().mockResolvedValue(resumedThread("child", { parentThreadId: "parent", threadSource: "subAgentThreadSpawn" })),
    });
    connectionMockState().client = client;
    const view = await chatView();

    await view.surface.activateThread("child");
    expect(view.getState()).toEqual({ version: 1 });
    connectionMockState().onExit?.();

    expect(view.getState()).toEqual({ version: 1 });
  });

  it.each(["other", "unavailable", "fork-draft", "close"] as const)(
    "keeps the persistent child subscribed when leaving its panel for %s",
    async (destination) => {
      const client = connectedClient({
        "thread/resume": vi.fn((params: unknown) => {
          const threadId = (params as { threadId: string }).threadId;
          return Promise.resolve(
            threadId === "unavailable"
              ? null
              : resumedThread(threadId, threadId === "child" ? { parentThreadId: "parent", threadSource: "subAgentThreadSpawn" } : {}),
          );
        }),
      });
      connectionMockState().client = client;
      const view = await chatView();
      const surface = view.surface;
      await view.surface.activateThread("child");
      if (destination !== "fork-draft") {
        connectionMockState().onNotification?.({
          method: "turn/started",
          params: {
            threadId: "child",
            turn: runningTurn("turn-child"),
          },
        } satisfies Extract<ServerNotification, { method: "turn/started" }>);
      }

      if (destination === "close") await view.onClose();
      else if (destination === "fork-draft") {
        await view.surface.applyForkDraft({
          draft: { kind: "persistent", sourceThreadId: "child", boundary: { kind: "through-turn", turnId: "turn-child" } },
          runtime: createChatState().runtime,
          display: { items: [], turnDiffs: new Map() },
        });
      } else await view.surface.activateThread(destination);

      expect(requestMethods(client)).not.toContain("thread/unsubscribe");
      expect(requestMethods(client)).not.toContain("turn/interrupt");
      expect(surface.openPanelSnapshot()).toMatchObject({
        threadId: destination === "unavailable" ? "child" : destination === "other" ? "other" : null,
        ...(destination === "unavailable" ? { turnBusy: true } : {}),
        hasForkDraft: destination === "fork-draft",
      });
    },
  );

  it("answers child approvals in the parent after the child panel navigates away and closes", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) => {
        const threadId = (params as { threadId: string }).threadId;
        return Promise.resolve(
          resumedThread(threadId, threadId === "child" ? { parentThreadId: "parent", threadSource: "subAgentThreadSpawn" } : {}),
        );
      }),
    });
    connectionMockState().client = client;
    const transport = { handlers: null as ConnectionManagerHandlers | null };
    const disconnect = vi.fn();
    const connection = new AppServerContextConnection(
      "codex",
      "/vault",
      { clientInfo: { name: "test", title: "Test", version: "0" }, capabilities: { experimentalApi: true, requestAttestation: false } },
      { onNotification: () => false, onExit: () => undefined },
      {
        connect: async (handlers) => {
          transport.handlers = handlers;
          return { codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "linux", userAgent: "test" };
        },
        currentClient: () => client as unknown as AppServerClient,
        disconnect,
      },
    );
    const host = { ...chatHost(), appServerConnection: connection };
    const child = await chatView({ host });
    const parent = await chatView({ host });
    try {
      await child.onOpen();
      await parent.onOpen();
      await child.surface.activateThread("child");
      await parent.surface.activateThread("parent");
      transport.handlers?.onNotification({
        method: "turn/started",
        params: {
          threadId: "parent",
          turn: runningTurn("parent-turn"),
        },
      });
      transport.handlers?.onNotification({
        method: "thread/started",
        params: { thread: { ...threadFixture("child"), parentThreadId: "parent", threadSource: "subAgentThreadSpawn" } },
      } as ServerNotification);
      transport.handlers?.onNotification({
        method: "turn/started",
        params: {
          threadId: "child",
          turn: runningTurn("child-turn"),
        },
      });
      await child.surface.startNewThread();
      expect(child.surface.openPanelSnapshot()).toMatchObject({ threadId: null, turnBusy: false, hasForkDraft: false });
      for (const id of [51, 52]) {
        const responder = { respond: vi.fn(), reject: vi.fn() };
        transport.handlers?.onServerRequest(
          {
            id,
            method: "item/commandExecution/requestApproval",
            params: {
              kind: "command",
              command: "npm test",
              cwd: "/vault",
              threadId: "child",
              turnId: "child-turn",
              itemId: `command-${id}`,
              approvalId: null,
              environmentId: null,
              startedAtMs: 1,
              reason: null,
              commandActions: [],
              proposedExecpolicyAmendment: null,
              proposedNetworkPolicyAmendments: [],
              availableDecisions: ["accept", "decline"],
            },
          } satisfies ServerRequest,
          responder,
        );
        await waitForAsyncWork(() => expect(parent.containerEl.textContent).toContain("npm test"));
        expect(child.containerEl.textContent).not.toContain("npm test");
        const allow = [...parent.containerEl.querySelectorAll("button")].find((button) => button.textContent === "Allow");
        if (!allow) throw new Error("Missing child approval action in parent panel");
        allow.click();
        await waitForAsyncWork(() => expect(responder.respond).toHaveBeenCalledExactlyOnceWith({ decision: "accept" }));
        expect(responder.reject).not.toHaveBeenCalled();
        await child.onClose();
      }
      expect(requestMethods(client)).not.toContain("thread/unsubscribe");
      expect(disconnect).not.toHaveBeenCalled();
    } finally {
      await child.onClose();
      await parent.onClose();
      connection.dispose();
    }
    expect(disconnect).toHaveBeenCalledOnce();
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

    await host.threadCatalog.fetchActiveThreads();
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
