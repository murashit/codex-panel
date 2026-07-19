// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import { createThreadNameMutationCoordinator } from "../../../../src/features/threads/workflows/thread-name-mutation-coordinator";
import { notices } from "../../../mocks/obsidian";
import { deferred, waitForAsyncWork } from "../../../support/async";
import {
  chatHost,
  chatView,
  connectedClient,
  connectionMockState,
  expectRequestTimes,
  flushAsyncTicks,
  panelThread,
  requestMethods,
  requiredButton,
  requiredTextArea,
  resumedThread,
  setupViewConnectionHarness,
  submitComposerByEnter,
  type TestAppServerClient,
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

  it("keeps connect calls joined while metadata is still loading", async () => {
    const config = deferred<unknown>();
    const client = connectedClient({
      "config/read": vi.fn(() => config.promise),
    });
    connectionMockState().client = client;
    const view = await chatView();

    const firstConnect = view.surface.connect();
    await waitForAsyncWork(() => {
      expectRequestTimes(client, "config/read", 1);
    });

    let secondResolved = false;
    const secondConnect = view.surface.connect().then(() => {
      secondResolved = true;
    });
    await Promise.resolve();

    expect(connectionMockState().connected).toBe(true);
    expect(secondResolved).toBe(false);

    config.resolve({});
    await Promise.all([firstConnect, secondConnect]);

    expectRequestTimes(client, "config/read", 1);
    expectRequestTimes(client, "thread/list", 1);
  });

  it("loads app-server metadata after connecting", async () => {
    connectionMockState().client = connectedClient();
    const view = await chatView();

    await view.surface.connect();

    expectRequestTimes(connectionMockState().client as TestAppServerClient, "config/read", 1);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });
  });

  it("reconnects and resumes the active thread only when settings change the app-server context", async () => {
    connectionMockState().client = connectedClient();
    const host = chatHost();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });

    host.settingsSource.showToolbar = false;
    view.surface.refreshSettings();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true });

    await view.surface.openThread("thread-1");
    const nextClient = connectedClient();
    connectionMockState().client = nextClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(connectionMockState().connectCalls).toBe(2);
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("invalidates the old connection before publishing a new app-server context", async () => {
    connectionMockState().client = connectedClient();
    const host = chatHost();
    const view = await chatView({ host });

    await view.surface.connect();
    expect(view.surface.openPanelSnapshot().connected).toBe(true);

    view.surface.prepareAppServerContextChange();

    expect(view.surface.openPanelSnapshot().connected).toBe(false);
    expect(host.settingsSource.codexPath).toBe("codex");
    expect(connectionMockState().connectCalls).toBe(1);

    connectionMockState().client = connectedClient();
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(connectionMockState().connectCalls).toBe(2);
      expect(view.surface.openPanelSnapshot().connected).toBe(true);
    });
  });

  it("keeps a disconnected panel's awaiting thread across an app-server context replacement", async () => {
    connectionMockState().client = connectedClient();
    const host = chatHost();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    connectionMockState().connected = false;
    connectionMockState().onExit?.();
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: false, threadId: "thread-1" });

    view.surface.prepareAppServerContextChange();
    const nextClient = connectedClient();
    connectionMockState().client = nextClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();

    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("does not run an inline rename queued before an app-server context replacement", async () => {
    const oldClient = connectedClient();
    connectionMockState().client = oldClient;
    const nameMutations = createThreadNameMutationCoordinator();
    const mutationRun = vi.spyOn(nameMutations, "run");
    const host = chatHost({ threadNameMutations: nameMutations });
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    host.receiveActiveThreads([panelThread({ id: "thread-1", name: "Original" })]);
    await view.surface.openThread("thread-1");

    const blocker = deferred<void>();
    const blockerWork = nameMutations.run("thread-1", () => blocker.promise);
    requiredButton(view.containerEl, '[aria-label="Show thread list"]').click();
    await flushAsyncTicks();
    requiredButton(view.containerEl, '[aria-label="Rename thread"]').click();
    await flushAsyncTicks();
    const input = view.containerEl.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input");
    if (!input) throw new Error("Missing inline rename input");
    input.value = "Queued in A";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flushAsyncTicks();
    expect(mutationRun).toHaveBeenCalledTimes(2);

    view.surface.prepareAppServerContextChange();
    const nextClient = connectedClient();
    connectionMockState().client = nextClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => expect(connectionMockState().connectCalls).toBe(2));
    blocker.resolve(undefined);
    await blockerWork;
    await flushAsyncTicks();

    expectRequestTimes(oldClient, "thread/name/set", 0);
    expectRequestTimes(nextClient, "thread/name/set", 0);
  });

  it("does not run a slash rename queued before an app-server context replacement", async () => {
    const oldClient = connectedClient();
    connectionMockState().client = oldClient;
    const nameMutations = createThreadNameMutationCoordinator();
    const mutationRun = vi.spyOn(nameMutations, "run");
    const host = chatHost({ threadNameMutations: nameMutations });
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    host.receiveActiveThreads([panelThread({ id: "thread-1", name: "Original" })]);
    const blocker = deferred<void>();
    const blockerWork = nameMutations.run("thread-1", () => blocker.promise);
    view.surface.setComposerText('/rename "Original" Queued in A');
    await submitComposerByEnter(view);
    expect(mutationRun).toHaveBeenCalledTimes(2);

    view.surface.prepareAppServerContextChange();
    const nextClient = connectedClient();
    connectionMockState().client = nextClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => expect(connectionMockState().connectCalls).toBe(2));
    blocker.resolve(undefined);
    await blockerWork;
    await flushAsyncTicks();

    expectRequestTimes(oldClient, "thread/name/set", 0);
    expectRequestTimes(nextClient, "thread/name/set", 0);
  });

  it("resumes each panel's captured thread after a shared app-server context replacement", async () => {
    const host = chatHost();
    const resumeRequestedThread = vi.fn((params: unknown) => {
      const threadId = (params as { threadId: string }).threadId;
      return resumedThread(threadId);
    });
    const oldClient = connectedClient({ "thread/resume": resumeRequestedThread });
    connectionMockState().client = oldClient;
    const first = await chatView({ host });
    const second = await chatView({ host });

    await first.onOpen();
    await second.onOpen();
    await first.surface.connect();
    await second.surface.connect();
    await first.surface.openThread("thread-1");
    await second.surface.openThread("thread-2");

    first.surface.prepareAppServerContextChange();
    second.surface.prepareAppServerContextChange();
    const nextClient = connectedClient({ "thread/resume": resumeRequestedThread });
    connectionMockState().client = nextClient;
    host.settingsSource.codexPath = "codex-next";
    first.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }));
    });

    connectionMockState().connected = false;
    second.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expect(nextClient.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-2", cwd: "/vault" }));
      expect(first.surface.openPanelSnapshot().threadId).toBe("thread-1");
      expect(second.surface.openPanelSnapshot().threadId).toBe("thread-2");
    });
  });

  it("keeps the captured thread across consecutive app-server context replacements", async () => {
    const host = chatHost();
    const firstClient = connectedClient();
    connectionMockState().client = firstClient;
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const stalledConfig = deferred<unknown>();
    const stalledClient = connectedClient({ "config/read": vi.fn(() => stalledConfig.promise) });
    view.surface.prepareAppServerContextChange();
    connectionMockState().client = stalledClient;
    host.settingsSource.codexPath = "codex-broken";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(stalledClient, "config/read", 1);
    });

    const recoveredClient = connectedClient();
    view.surface.prepareAppServerContextChange();
    connectionMockState().client = recoveredClient;
    host.settingsSource.codexPath = "codex-recovered";
    view.surface.refreshSettings();

    await waitForAsyncWork(() => {
      expect(recoveredClient.request).toHaveBeenCalledWith(
        "thread/resume",
        expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }),
      );
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });

    stalledConfig.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectRequestTimes(recoveredClient, "thread/resume", 1);
  });

  it("keeps the captured thread after a context reconnect cannot resume it", async () => {
    const host = chatHost();
    connectionMockState().client = connectedClient();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const failedClient = connectedClient({ "thread/resume": vi.fn().mockResolvedValue(null) });
    view.surface.prepareAppServerContextChange();
    connectionMockState().client = failedClient;
    host.settingsSource.codexPath = "codex-broken";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(failedClient, "thread/resume", 1);
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: null });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveredClient = connectedClient();
    view.surface.prepareAppServerContextChange();
    connectionMockState().client = recoveredClient;
    host.settingsSource.codexPath = "codex-recovered";
    view.surface.refreshSettings();

    await waitForAsyncWork(() => {
      expect(recoveredClient.request).toHaveBeenCalledWith(
        "thread/resume",
        expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }),
      );
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("retries the captured thread when reconnecting after a context resume failure", async () => {
    const host = chatHost();
    connectionMockState().client = connectedClient();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const failedClient = connectedClient({ "thread/resume": vi.fn().mockResolvedValue(null) });
    view.surface.prepareAppServerContextChange();
    connectionMockState().client = failedClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(failedClient, "thread/resume", 1);
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: null });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveredClient = connectedClient();
    connectionMockState().client = recoveredClient;
    view.surface.setComposerText("/reconnect");
    await submitComposerByEnter(view);

    await waitForAsyncWork(() => {
      expect(recoveredClient.request).toHaveBeenCalledWith(
        "thread/resume",
        expect.objectContaining({ threadId: "thread-1", cwd: "/vault" }),
      );
      expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
    });
  });

  it("does not let a stale automatic reconnect resume again after a manual retry", async () => {
    const host = chatHost();
    connectionMockState().client = connectedClient();
    const view = await chatView({ host });

    await view.onOpen();
    await view.surface.connect();
    await view.surface.openThread("thread-1");

    const stalledConfig = deferred<unknown>();
    const stalledClient = connectedClient({ "config/read": vi.fn(() => stalledConfig.promise) });
    view.surface.prepareAppServerContextChange();
    connectionMockState().client = stalledClient;
    host.settingsSource.codexPath = "codex-next";
    view.surface.refreshSettings();
    await waitForAsyncWork(() => {
      expectRequestTimes(stalledClient, "config/read", 1);
    });

    const recoveredClient = connectedClient();
    connectionMockState().client = recoveredClient;
    view.surface.setComposerText("/reconnect");
    await submitComposerByEnter(view);
    await waitForAsyncWork(() => {
      expectRequestTimes(recoveredClient, "thread/resume", 1);
    });

    stalledConfig.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectRequestTimes(recoveredClient, "thread/resume", 1);
    expect(view.surface.openPanelSnapshot()).toMatchObject({ connected: true, threadId: "thread-1" });
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
    await Promise.resolve();
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
