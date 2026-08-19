// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import type { ThreadGoal } from "../../../../src/domain/threads/goal";
import { notices } from "../../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../../support/async";
import {
  chatHost,
  chatView,
  chatViewRuntimeOwner,
  completedTurn,
  connectedClient,
  connectionMockState,
  expectRequestTimes,
  requestMethods,
  requiredButton,
  requiredTextArea,
  resumedThread,
  setupViewConnectionHarness,
  type TestAppServerClient,
  threadFixture,
} from "./view-connection-harness";

describe("CodexChatView connection lifecycle", () => {
  setupViewConnectionHarness();

  it("shares post-initialize metadata loading across concurrent connect calls", async () => {
    const client = connectedClient();
    const fetchModels = vi.fn().mockResolvedValue([]);
    connectionMockState().client = client;
    const view = await chatView({ host: chatHost({ fetchModels }) });

    await Promise.all([view.surface.connect(), view.surface.connect()]);

    expect(connectionMockState().connectCalls).toBe(1);
    expectRequestTimes(client, "config/read", 1);
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expectRequestTimes(client, "skills/list", 1);
    expectRequestTimes(client, "permissionProfile/list", 1);
    expectRequestTimes(client, "account/rateLimits/read", 1);
    expectRequestTimes(client, "thread/list", 1);
  });

  it("resumes while metadata is still loading without reconnecting", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn(() => config.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();

    const opening = view.surface.activateThread("thread-1");
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "config/read", 1);
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
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
    expectRequestTimes(client, "thread/list", 0);

    config.resolve({});
    await fullyConnected;
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "thread/list", 1);
    });

    expectRequestTimes(client, "config/read", 1);
  });

  it("keeps the latest explicit target when an older activation finishes later", async () => {
    const delayed = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn((params) => {
        const { threadId } = params as { threadId: string };
        return threadId === "thread-b" ? delayed.promise : Promise.resolve(resumedThread(threadId));
      }),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.surface.activateThread("thread-a", { focus: false });

    const openingB = view.surface.activateThread("thread-b", { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-b", cwd: "/vault" }));
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
    connectionMockState().client = client;
    const view = await chatView();

    const opening = view.surface.activateThread("thread-a", { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/turns/list", expect.objectContaining({ threadId: "thread-a" }));
    });
    const reselecting = view.surface.activateThread("thread-a", { focus: false });

    history.resolve({ data: [], nextCursor: null });
    await Promise.all([opening, reselecting]);

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-a");
    expect(client.request).toHaveBeenCalledWith("thread/goal/get", { threadId: "thread-a" });
  });

  it("keeps the current thread and draft when another thread cannot be resumed", async () => {
    const client = connectedClient({
      "thread/resume": vi.fn((params) => {
        const { threadId } = params as { threadId: string };
        return threadId === "thread-b" ? Promise.reject(new Error("Resume failed")) : Promise.resolve(resumedThread(threadId));
      }),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();
    await view.surface.activateThread("thread-a", { focus: false });
    view.surface.setComposerText("Keep this draft");

    await view.surface.activateThread("thread-b", { focus: false });

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-a");
    expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Keep this draft");
  });

  it("does not replace explicit navigation with a passive panel focus", async () => {
    const delayed = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn((params) => {
        const { threadId } = params as { threadId: string };
        return threadId === "thread-b" ? delayed.promise : Promise.resolve(resumedThread(threadId));
      }),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.surface.activateThread("thread-a", { focus: false });

    const openingB = view.surface.activateThread("thread-b", { focus: false });
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/resume", 2));
    await view.surface.activateThread(undefined, { focus: false });
    delayed.resolve(resumedThread("thread-b"));
    await openingB;

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-b");
  });

  it("commits source cleanup when a newer target wins immediately after activation", async () => {
    const unsubscribe = vi.fn().mockResolvedValue({});
    const client = connectedClient({
      "thread/resume": vi.fn((params) => {
        const { threadId } = params as { threadId: string };
        return Promise.resolve(
          resumedThread(
            threadId,
            threadId === "thread-a"
              ? {
                  parentThreadId: "parent",
                  sessionId: "session",
                  threadSource: "subAgentThreadSpawn",
                  agentNickname: "Scout",
                  agentRole: "explorer",
                }
              : {},
          ),
        );
      }),
      "thread/unsubscribe": unsubscribe,
    });
    connectionMockState().client = client;
    let view: Awaited<ReturnType<typeof chatView>>;
    let newerActivation: Promise<void> | null = null;
    const notifyPanelActivityChanged = vi.fn(() => {
      if (newerActivation || view?.surface.openPanelSnapshot().threadId !== "thread-b") return;
      newerActivation = view.surface.activateThread("thread-c", { focus: false });
    });
    view = await chatView({ host: chatHost({ notifyPanelActivityChanged }) });
    await view.surface.activateThread("thread-a", { focus: false });

    await view.surface.activateThread("thread-b", { focus: false });
    await newerActivation;

    await waitForAsyncWork(() => {
      expect(unsubscribe).toHaveBeenCalledWith({ threadId: "thread-a" }, expect.anything());
    });
  });

  it("loads app-server metadata after connecting", async () => {
    connectionMockState().client = connectedClient();
    const view = await chatView();

    await view.surface.connect();

    expectRequestTimes(connectionMockState().client as TestAppServerClient, "config/read", 1);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });
  });

  it("keeps a preserved draft editable while workspace coordination restores its thread", async () => {
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
    connectionMockState().client = nextClient;
    owner.replace(nextHost);

    expect(requestMethods(nextClient)).not.toContain("thread/resume");
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1" });
    await waitForAsyncWork(() => {
      expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Keep this draft");
    });

    view.surface.setComposerText("Edited while reconnecting");

    const restoring = view.surface.activateThread();
    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    });
    resumed.resolve(resumedThread("thread-1"));
    await restoring;

    await waitForAsyncWork(() => {
      expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Edited while reconnecting");
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("keeps a reselected source thread when fork replacement resume finishes later", async () => {
    const applyThreadFact = vi.fn();
    const replacementResume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn((params) => {
        const { threadId } = params as { threadId: string };
        if (threadId === "thread-forked") return replacementResume.promise;
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
    connectionMockState().client = client;
    const view = await chatView({ host: chatHost({ applyThreadFact }) });
    await view.onOpen();
    await view.surface.activateThread("thread-1", { focus: false });

    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__fork-dialogue")).not.toBeNull();
    });
    requiredButton(view.containerEl, ".codex-panel__fork-dialogue").click();
    await waitForAsyncWork(() => {
      expect(view.containerEl.querySelector(".codex-panel__fork-and-archive-dialogue")).not.toBeNull();
    });
    requiredButton(view.containerEl, ".codex-panel__fork-and-archive-dialogue").click();
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-forked", cwd: "/vault" }));
    });

    await view.surface.activateThread("thread-1", { focus: false });
    replacementResume.resolve(resumedThread("thread-forked"));
    await vi.waitFor(() => {
      expect(applyThreadFact).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread-upserted", thread: expect.objectContaining({ id: "thread-forked" }) }),
      );
    });

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

    connectionMockState().client = connectedClient({
      "thread/resume": vi.fn((params) => Promise.resolve(resumedThread((params as { threadId: string }).threadId))),
    });
    owner.replace(chatHost());

    await view.surface.activateThread("thread-b");

    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-b");
    expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("");
  });

  it("recreates a side chat from its source intent instead of reusing the old ephemeral thread", async () => {
    const owner = chatViewRuntimeOwner(chatHost());
    const firstClient = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("ephemeral-a") }),
    });
    connectionMockState().client = firstClient;
    const view = await chatView({ runtimeOwner: owner });
    await view.onOpen();
    await view.surface.connect();
    await view.surface.openSideChat({ sourceThreadId: "source", sourceThreadTitle: "Source" });
    view.surface.setComposerText("Side draft");

    const nextHost = chatHost();
    nextHost.settingsSource.codexPath = "codex-next";
    const nextClient = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("ephemeral-b") }),
    });
    connectionMockState().client = nextClient;
    owner.replace(nextHost);

    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/fork", expect.objectContaining({ threadId: "source", cwd: "/vault" }));
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "ephemeral-b" });
      expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Side draft");
    });
    expect(view.surface.openPanelSnapshot().threadId).not.toBe("ephemeral-a");
  });

  it("sends an initial message after opening a side chat", async () => {
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("side") }),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();

    await view.surface.openSideChat({
      sourceThreadId: "source",
      sourceThreadTitle: "Source",
      initialMessage: "Explain this briefly",
    });

    expect(client.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        threadId: "side",
        input: [expect.objectContaining({ type: "text", text: "Explain this briefly" })],
      }),
    );
  });

  it("restores an initial message to the composer when its first send fails", async () => {
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn().mockResolvedValue({ thread: threadFixture("side") }),
      "turn/start": vi.fn().mockRejectedValue(new Error("offline")),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();

    await expect(
      view.surface.openSideChat({
        sourceThreadId: "source",
        sourceThreadTitle: "Source",
        initialMessage: "Explain this briefly",
      }),
    ).resolves.toBe(false);

    expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Explain this briefly");
  });

  it("publishes side-chat preparation as pending before the fork completes", async () => {
    const fork = deferred<{ thread: ReturnType<typeof threadFixture> }>();
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn(() => fork.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();
    const refreshHeader = vi.fn();
    Object.assign(view.leaf, { updateHeader: refreshHeader });

    const opening = view.surface.openSideChat({ sourceThreadId: "source", sourceThreadTitle: "Source" }, { focus: false });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/fork", expect.objectContaining({ threadId: "source", cwd: "/vault" }));
    });

    expect(view.getDisplayText()).toBe("Side chat");
    expect(view.getState()).toEqual({
      version: 2,
      ephemeralSource: { threadId: "source", title: "Source" },
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({
      threadId: null,
      pending: true,
    });
    expect(refreshHeader).toHaveBeenCalled();

    fork.resolve({ thread: threadFixture("side") });
    await expect(opening).resolves.toBe(true);

    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "side", pending: false });
  });

  it("lets a newer thread navigation supersede a pending side chat regardless of completion order", async () => {
    const fork = deferred<{ thread: ReturnType<typeof threadFixture> }>();
    const resume = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "config/read": vi.fn().mockResolvedValue({ config: { developer_instructions: null } }),
      "thread/fork": vi.fn(() => fork.promise),
      "thread/resume": vi.fn(() => resume.promise),
      "thread/unsubscribe": vi.fn().mockResolvedValue({}),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();

    const openingSide = view.surface.openSideChat({ sourceThreadId: "source", sourceThreadTitle: "Source" }, { focus: false });
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/fork", 1));
    const openingThread = view.surface.activateThread("thread-1", { focus: false });
    await waitForAsyncWork(() => expectRequestTimes(client, "thread/resume", 1));

    fork.resolve({ thread: threadFixture("stale-side") });
    await expect(openingSide).resolves.toBe(false);
    expect(view.getState()).not.toHaveProperty("ephemeralSource");

    resume.resolve(resumedThread("thread-1"));
    await openingThread;

    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-1", pending: false });
    expect(view.getState()).toMatchObject({ version: 1, threadId: "thread-1" });
    expect(client.request).toHaveBeenCalledWith(
      "thread/unsubscribe",
      { threadId: "stale-side" },
      expect.objectContaining({ timeoutMs: 5_000 }),
    );
  });

  it("starts an empty thread when saving a toolbar goal from a blank panel", async () => {
    vi.useFakeTimers();
    const client = connectedClient({
      "thread/goal/set": vi.fn().mockResolvedValue({
        goal: {
          threadId: "thread-new",
          objective: "Ship the feature",
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();

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

    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/start", {
        cwd: "/vault",
        historyMode: "paginated",
        serviceName: "codex-panel",
      });
      expect(client.request).toHaveBeenCalledWith("thread/goal/set", {
        threadId: "thread-new",
        objective: "Ship the feature",
        status: "active",
        tokenBudget: null,
      });
    });
    expect(client.request).not.toHaveBeenCalledWith("thread/inject_items", expect.anything());
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-new" });
    await waitForAsyncWork(() => {
      expect(view.containerEl.textContent).toContain("Ship the feature");
    });
  });

  it("keeps a goal update notification over an earlier in-flight goal read", async () => {
    const oldRead = deferred<{ goal: ThreadGoal | null }>();
    const client = connectedClient({
      "thread/goal/get": vi.fn(() => oldRead.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();

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

  it("keeps a goal clear notification over an earlier in-flight goal read", async () => {
    const oldRead = deferred<{ goal: ThreadGoal | null }>();
    const client = connectedClient({
      "thread/goal/get": vi.fn(() => oldRead.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();

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
    connectionMockState().client = client;
    const view = await chatView();

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
        turn: {
          id: "late-turn",
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
    expect(notifyPanelActivityChanged).toHaveBeenCalledTimes(2);
  });

  it("ignores stale connection work after the app-server exits during metadata loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn(() => config.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();

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
