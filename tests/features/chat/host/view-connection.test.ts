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

    const opening = view.surface.openThread("thread-1");
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

  it("loads app-server metadata after connecting", async () => {
    connectionMockState().client = connectedClient();
    const view = await chatView();

    await view.surface.connect();

    expectRequestTimes(connectionMockState().client as TestAppServerClient, "config/read", 1);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });
  });

  it("recreates the session while preserving its thread target and composer draft", async () => {
    const owner = chatViewRuntimeOwner(chatHost());
    connectionMockState().client = connectedClient();
    const view = await chatView({ runtimeOwner: owner });
    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");
    view.surface.setComposerText("Keep this draft");

    const nextHost = chatHost();
    nextHost.settingsSource.codexPath = "codex-next";
    const nextClient = connectedClient();
    connectionMockState().client = nextClient;
    owner.replace(nextHost);

    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
      expect(requiredTextArea(view.containerEl, ".codex-panel__composer-input").value).toBe("Keep this draft");
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
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
      publishedActivity: { pending: true },
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
    const openingThread = view.surface.openThread("thread-1", { focus: false });
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
      expect(client.request).toHaveBeenCalledWith("thread/start", { cwd: "/vault", serviceName: "codex-panel" });
      expect(client.request).toHaveBeenCalledWith("thread/goal/set", {
        threadId: "thread-new",
        objective: "Ship the feature",
        status: "active",
        tokenBudget: null,
      });
    });
    await waitForAsyncWork(() => {
      expect(client.request).toHaveBeenCalledWith("thread/inject_items", {
        threadId: "thread-new",
        items: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Ship the feature" }],
          },
        ],
      });
    });
    expect(view.surface.openPanelSnapshot()).toMatchObject({ threadId: "thread-new" });
    expect(view.containerEl.textContent).toContain("Ship the feature");
  });

  it("keeps a goal update notification over an earlier in-flight goal read", async () => {
    const oldRead = deferred<{ goal: ThreadGoal | null }>();
    const client = connectedClient({
      "thread/goal/get": vi.fn(() => oldRead.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();
    await view.onOpen();

    const opening = view.surface.openThread("thread-1", { focus: false });
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

    const opening = view.surface.openThread("thread-1", { focus: false });
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
    await view.surface.openThread("thread-1");
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
