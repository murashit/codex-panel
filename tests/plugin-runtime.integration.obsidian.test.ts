import * as contextConnection from "../src/app-server/connection/context-connection";
// @vitest-environment jsdom

import * as obsidian from "obsidian";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { AppServerClient } from "../src/app-server/connection/client";
import type { ConnectionManagerHandlers } from "../src/app-server/connection/connection-manager";
import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "../src/constants";
import type { Thread } from "../src/domain/threads/model";
import { sideChatDraft } from "../src/features/chat/application/threads/fork-draft";
import type { ChatRuntimeView, CodexChatHost } from "../src/features/chat/host/contracts";
import { CodexChatView } from "../src/features/chat/host/view.obsidian";
import { CodexThreadsView } from "../src/features/threads-view/view.obsidian";
import { CodexTurnDiffView } from "../src/features/turn-diff/view.obsidian";
import type CodexPanelPlugin from "../src/main";
import {
  completedTurn,
  connectedClient,
  editToolbarGoal,
  requiredTextArea,
  resumedThread,
  submitComposerByEnter,
} from "./features/chat/host/view-connection-harness";
import { notices } from "./mocks/obsidian";
import { deferred, waitForAsyncWork } from "./support/async";
import { installObsidianDomShims } from "./support/dom";
import {
  chatView,
  flushMicrotasks,
  leaf,
  pluginWithLeaves,
  publishCodexPath,
  type TestLeaf,
  thread,
  threadListClient,
} from "./support/plugin-fixtures";

installObsidianDomShims();

const contextConnectionClientMock = vi.fn();
const ActualContextConnection = contextConnection.AppServerContextConnection;

function threadCatalog(plugin: CodexPanelPlugin) {
  return currentChatHost(plugin).threadCatalog;
}

function threadFacts(plugin: CodexPanelPlugin) {
  return currentChatHost(plugin).threadFacts;
}

let connectionHandlers: ConnectionManagerHandlers;

const capturedChatHosts = new WeakMap<CodexPanelPlugin, { current: CodexChatHost | null }>();

function currentChatHost(plugin: CodexPanelPlugin): CodexChatHost {
  let capture = capturedChatHosts.get(plugin);
  if (!capture) {
    const createdCapture = { current: null as CodexChatHost | null };
    const view = Object.assign(Object.create(CodexChatView.prototype), {
      isRuntimeAttached: () => false,
      attachRuntime: (host: CodexChatHost) => {
        createdCapture.current = host;
      },
      detachRuntime: async () => {
        createdCapture.current = null;
      },
    }) as ChatRuntimeView;
    const runtimeLeaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_PANEL) as unknown as TestLeaf[];
    const runtimeLeaf = leaf();
    runtimeLeaf.view = view;
    runtimeLeaves.push(runtimeLeaf);
    capturedChatHosts.set(plugin, createdCapture);
    capture = createdCapture;
    plugin.runtime.attachChatView(view);
  }
  if (!capture.current) throw new Error("Expected a captured chat runtime host.");
  return capture.current;
}

describe("CodexPanelPlugin runtime integration", () => {
  beforeEach(() => {
    vi.useRealTimers();
    contextConnectionClientMock.mockReset();
    vi.spyOn(contextConnection, "AppServerContextConnection").mockImplementation(
      class extends ActualContextConnection {
        constructor(...args: ConstructorParameters<typeof ActualContextConnection>) {
          let client: AppServerClient | null = null;
          super(args[0], args[1], args[2], args[3], {
            connect: async (handlers) => {
              connectionHandlers = handlers;
              client ??= contextConnectionClientMock(args[0], args[1]);
              return { codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" };
            },
            currentClient: () => client,
            disconnect: () => {
              client = null;
            },
          });
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("drops old pending and queued selections while accepting navigation from the replacement", async () => {
    const pending = deferred<ReturnType<typeof resumedThread>>();
    const oldClient = connectedClient({ "thread/resume": vi.fn(() => pending.promise) });
    const nextClient = connectedClient();
    contextConnectionClientMock.mockImplementation((path: string) => (path === "codex" ? oldClient : nextClient));
    const target = leaf();
    const plugin = await pluginWithLeaves([target]);
    const view = attachTestPanel(plugin, target);
    const old = currentChatHost(plugin).workspace;
    const opening = old.openThreadInAvailableView("thread-1");
    await vi.waitFor(() => {
      expect(oldClient.request).toHaveBeenCalledWith("thread/resume", expect.anything(), expect.anything());
    });
    const queued = old.openThreadInAvailableView("thread-1");
    await publishCodexPath(plugin, "codex-next");
    pending.resolve(resumedThread("thread-1"));
    await Promise.all([opening, queued]);
    expect(nextClient.request).not.toHaveBeenCalledWith("thread/resume", expect.anything(), expect.anything());
    expect(view.surface.openPanelSnapshot().threadId).toBeNull();
    await currentChatHost(plugin).workspace.openThreadInAvailableView("thread-1");
    expect(view.surface.openPanelSnapshot().threadId).toBe("thread-1");
  });

  it.each([false, true])("uses activation-owned loading to allocate panels, clear=%s", async (clear) => {
    const pending = deferred<ReturnType<typeof resumedThread>>();
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) =>
        params && typeof params === "object" && "threadId" in params && params.threadId === "one"
          ? pending.promise
          : Promise.resolve(resumedThread("two")),
      ),
    });
    contextConnectionClientMock.mockReturnValue(client);
    const first = leaf();
    const leaves = [first];
    const plugin = await pluginWithLeaves(leaves);
    const view = chatView(CodexChatView, first, plugin.runtime);
    first.view = view;
    const additional = leaf();
    const other = chatView(CodexChatView, additional, plugin.runtime);
    additional.setViewState.mockImplementation(async (state: { state: unknown }) => {
      additional.view = other;
      leaves.push(additional);
      await other.setState(state.state, { history: false });
    });
    (plugin.app.workspace.getRightLeaf as ReturnType<typeof vi.fn>).mockReturnValue(additional);
    onTestFinished(async () => {
      await view.onClose();
      await other.onClose();
      plugin.runtime.reset();
    });
    const workspace = currentChatHost(plugin).workspace;
    const one = workspace.openThreadInAvailableView("one");
    await vi.waitFor(() => {
      expect(client.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "one" }), expect.anything());
    });
    if (clear) await view.surface.startNewThread({ focus: false });
    await workspace.openThreadInAvailableView("two");
    pending.resolve(resumedThread("one"));
    await one;
    expect(
      [view, other]
        .filter((panel) => leaves.some((entry) => entry.view === panel))
        .map((panel) => panel.surface.openPanelSnapshot().threadId),
    ).toEqual(clear ? ["two"] : ["one", "two"]);
  });

  it("keeps an unsaved goal in its panel when another thread opens in an available panel", async () => {
    const { first, second, workspace } = await twoAvailablePanels();
    await editToolbarGoal(first, "Finish the release notes");

    await workspace.openThreadInAvailableView("thread-1");

    expect(second.getState()).toMatchObject({ threadId: "thread-1" });
    expect(first.getState()).toEqual({ version: 1 });
    expect(requiredTextArea(first.containerEl, ".codex-panel__goal-objective-input").value).toBe("Finish the release notes");
  });

  it("keeps a pending web submission in its panel when another thread opens in an available panel", async () => {
    const { first, second, workspace } = await twoAvailablePanels();
    const page = deferred<never>();
    const request = vi
      .spyOn(obsidian, "requestUrl")
      .mockReturnValue(Object.assign(page.promise, { arrayBuffer: page.promise, json: page.promise, text: page.promise }));
    const draft = "/web https://example.org Summarize the page";
    first.surface.setComposerText(draft);
    try {
      await submitComposerByEnter(first);
      await waitForAsyncWork(() => expect(request).toHaveBeenCalledOnce());
      expect(requiredTextArea(first.containerEl, ".codex-panel__composer-input").value).toBe("");

      await workspace.openThreadInAvailableView("thread-1");

      expect(second.getState()).toMatchObject({ threadId: "thread-1" });
      expect(first.getState()).toEqual({ version: 1 });
    } finally {
      page.reject(new Error("Page unavailable"));
    }
    await waitForAsyncWork(() => expect(requiredTextArea(first.containerEl, ".codex-panel__composer-input").value).toBe(draft));
  });

  it("keeps scoped navigation usable after a failed save and revokes it across A-to-B-to-A replacement", async () => {
    const target = leaf();
    const plugin = await pluginWithLeaves([target]);
    const view = attachTestPanel(plugin, target);
    const original = currentChatHost(plugin).workspace;
    const firstActivation = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
    vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    await expect(publishCodexPath(plugin, "codex-next")).rejects.toThrow("disk full");
    await original.openThreadInAvailableView("first");
    expect(firstActivation).toHaveBeenCalledOnce();
    await publishCodexPath(plugin, "codex-next");
    await publishCodexPath(plugin, "codex");
    const currentActivation = vi.spyOn(view.surface, "activateThread").mockResolvedValue(true);
    await original.openThreadInAvailableView("stale");
    expect(currentActivation).not.toHaveBeenCalled();
    await currentChatHost(plugin).workspace.openThreadInAvailableView("fresh");
    expect(currentActivation).toHaveBeenCalledWith("fresh", { focus: false });
  });

  it.each(["replace", "reset"])("keeps static diff presentation workspace-owned during %s", async (action) => {
    const plugin = await pluginWithLeaves([]);
    onTestFinished(() => {
      plugin.runtime.reset();
    });
    const diffLeaf = leaf();
    const diffView = new CodexTurnDiffView({ ...diffLeaf, containerEl: document.createElement("div") } as never);
    diffLeaf.view = diffView;
    const setPayload = vi.spyOn(diffView, "setDiffPayload");
    const loading = deferred<void>();
    diffLeaf.loadIfDeferred.mockReturnValue(loading.promise);
    Object.assign(plugin.app.workspace, { getLeaf: () => diffLeaf });
    const payload = { threadId: "thread", turnId: "turn", files: [], diff: "old snapshot" };
    const opening = currentChatHost(plugin).workspace.openTurnDiff(payload);
    await vi.waitFor(() => {
      expect(diffLeaf.loadIfDeferred).toHaveBeenCalledOnce();
    });
    if (action === "replace") await publishCodexPath(plugin, "codex-next");
    else {
      plugin.runtime.reset();
      plugin.runtime.initialize();
    }
    loading.resolve();
    await opening;
    expect(setPayload.mock.calls).toEqual(action === "replace" ? [[payload]] : []);
  });

  it("repairs duplicate ownership on panel activity changes without hydrating panels", async () => {
    const first = leaf({ state: { threadId: "same" } });
    const duplicate = leaf({ state: { threadId: "same" } });
    const plugin = await pluginWithLeaves([first, duplicate]);
    const host = currentChatHost(plugin);
    host.workspace.notifyPanelActivityChanged();
    host.workspace.notifyPanelActivityChanged();
    expect(duplicate.setViewState).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(duplicate.setViewState).toHaveBeenCalledOnce();
    expect(first.loadIfDeferred).not.toHaveBeenCalled();
    expect(duplicate.loadIfDeferred).not.toHaveBeenCalled();
    plugin.runtime.reset();
  });

  it("waits for the host to activate the threads view", async () => {
    const plugin = await pluginWithLeaves([]);
    const activation = deferred<TestLeaf>();
    const ensureSideLeaf = vi.fn(() => activation.promise);
    Object.assign(plugin.app.workspace, { ensureSideLeaf });
    const activated = vi.fn();

    const opening = plugin.runtime.activateThreadsView().then(activated);

    expect(ensureSideLeaf).toHaveBeenCalledWith(VIEW_TYPE_CODEX_THREADS, "left", { active: true, reveal: true });
    expect(activated).not.toHaveBeenCalled();
    activation.resolve(leaf());
    await opening;
    expect(activated).toHaveBeenCalledOnce();
    plugin.runtime.reset();
  });

  it("creates and loads a turn diff leaf before publishing its session payload", async () => {
    const plugin = await pluginWithLeaves([]);
    const diffLeaf = leaf();
    const events: string[] = [];
    const setDiffPayload = vi.spyOn(CodexTurnDiffView.prototype, "setDiffPayload").mockImplementation(() => {
      events.push("payload");
    });
    diffLeaf.setViewState.mockImplementation(async () => {
      diffLeaf.view = new CodexTurnDiffView({ ...diffLeaf, containerEl: document.createElement("div") } as never);
    });
    diffLeaf.loadIfDeferred.mockImplementation(async () => {
      events.push("load");
    });
    const getLeaf = vi.fn(() => diffLeaf);
    Object.assign(plugin.app.workspace, { getLeaf });
    const payload = { threadId: "thread", turnId: "turn", files: ["Note.md"], diff: "@@\n-old\n+new" };

    await currentChatHost(plugin).workspace.openTurnDiff(payload);

    expect(getLeaf).toHaveBeenCalledWith("tab");
    expect(diffLeaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true });
    expect(events).toEqual(["load", "payload"]);
    expect(setDiffPayload).toHaveBeenCalledWith(payload);
    expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(diffLeaf);
  });

  it("loads a reused turn diff leaf before replacing its session payload", async () => {
    const diffLeaf = leaf();
    const diffView = new CodexTurnDiffView({ ...diffLeaf, containerEl: document.createElement("div") } as never);
    diffLeaf.view = diffView;
    const plugin = await pluginWithLeaves([], { turnDiffLeaves: [diffLeaf] });
    const events: string[] = [];
    diffLeaf.loadIfDeferred.mockImplementation(async () => {
      events.push("load");
    });
    const setDiffPayload = vi.spyOn(diffView, "setDiffPayload").mockImplementation(() => {
      events.push("payload");
    });
    const payload = { threadId: "thread", turnId: "turn", files: ["Note.md"], diff: "@@\n-old\n+new" };

    await currentChatHost(plugin).workspace.openTurnDiff(payload);

    expect(diffLeaf.setViewState).not.toHaveBeenCalled();
    expect(events).toEqual(["load", "payload"]);
    expect(setDiffPayload).toHaveBeenCalledWith(payload);
    expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledWith(diffLeaf);
  });

  it("applies archive mutations to open chat surfaces and restored identities", async () => {
    const fetchArchivedThreads = vi.fn().mockResolvedValue([]);
    contextConnectionClientMock.mockImplementation(() => threadListClient(fetchArchivedThreads));
    const restoredMatchingLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored" } });
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstUnavailable = vi
      .spyOn((firstLeaf.view as CodexChatView).surface, "applyThreadUnavailable")
      .mockImplementation(() => undefined);
    const firstRefresh = vi.spyOn((firstLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondUnavailable = vi
      .spyOn((secondLeaf.view as CodexChatView).surface, "applyThreadUnavailable")
      .mockImplementation(() => undefined);
    const secondRefresh = vi.spyOn((secondLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([restoredMatchingLeaf, firstLeaf, secondLeaf]);

    threadFacts(plugin).apply({ type: "thread-archived", threadId: "thread-1" });
    await flushMicrotasks();

    expect(fetchArchivedThreads).toHaveBeenCalledOnce();
    expect(firstUnavailable).toHaveBeenCalledWith("thread-1");
    expect(secondUnavailable).toHaveBeenCalledWith("thread-1");
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).not.toHaveBeenCalled();
    expect(restoredMatchingLeaf.detach).not.toHaveBeenCalled();
    expect(firstLeaf.detach).not.toHaveBeenCalled();
    expect(secondLeaf.detach).not.toHaveBeenCalled();
    expect(restoredMatchingLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      state: { version: 1 },
    });
  });

  it("publishes rename and delayed toolbar Pin notifications across catalogs and panels", async () => {
    const moved = deferred<object>();
    const move = vi.fn(() => moved.promise);
    const listClient: { request(method: string, params: unknown): Promise<unknown> } = threadListClient(async () => [
      thread("unrelated"),
      thread("thread-1"),
    ]);
    const client = connectedClient({
      "thread/list": vi.fn((params: unknown) => listClient.request("thread/list", params)),
      "thread/section/move": move,
      "thread/resume": vi.fn((params: unknown) => Promise.resolve(resumedThread((params as { threadId: string }).threadId))),
    });
    contextConnectionClientMock.mockReturnValue(client);
    const firstLeaf = leaf();
    const secondLeaf = leaf();
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
    const first = chatView(CodexChatView, firstLeaf, plugin.runtime);
    const second = chatView(CodexChatView, secondLeaf, plugin.runtime);
    firstLeaf.view = first;
    secondLeaf.view = second;
    try {
      await first.onOpen();
      await first.surface.activateThread("thread-1");
      const catalog = threadCatalog(plugin);
      const archivedCatalog = plugin.runtime.settingTabHost().resources.threadCatalog;
      await catalog.fetchActiveThreads();
      await archivedCatalog.refreshArchivedThreads();
      const firstRenamed = vi.spyOn(first.surface, "applyThreadRenamed");
      const secondRenamed = vi.spyOn(second.surface, "applyThreadRenamed");
      const firstRefresh = vi.spyOn(first.surface, "refreshSharedThreads");
      const secondRefresh = vi.spyOn(second.surface, "refreshSharedThreads");
      threadFacts(plugin).apply({ type: "thread-renamed", threadId: "thread-1", name: "Renamed thread" });

      first.containerEl.querySelector<HTMLButtonElement>('[aria-label="Show thread list"]')?.click();
      const pinSelector = '.codex-panel__thread-row--selected [aria-label="Pin thread"]';
      await vi.waitFor(() => expect(first.containerEl.querySelector(pinSelector)).not.toBeNull());
      first.containerEl.querySelector<HTMLButtonElement>(pinSelector)?.click();
      await waitForAsyncWork(() => expect(move).toHaveBeenCalledOnce());
      expect(client.request).toHaveBeenCalledWith("thread/section/move", {
        threadId: "thread-1",
        sectionId: "01984de2-8f74-7c91-a3b2-5c5e937cf318",
      });
      await first.surface.activateThread("thread-2");
      moved.resolve({});
      await flushMicrotasks();
      expect(catalog.activeThreadsSnapshot()?.find((row) => row.id === "thread-1")?.isPinned).not.toBe(true);
      connectionHandlers.onNotification({
        method: "thread/section/changed",
        params: { threadId: "thread-1", sectionId: "01984de2-8f74-7c91-a3b2-5c5e937cf318" },
      });
      await vi.waitFor(() =>
        expect(catalog.activeThreadsSnapshot()?.find((row) => row.id === "thread-1")).toMatchObject({ isPinned: true }),
      );

      for (const rows of [catalog.activeThreadsSnapshot(), archivedCatalog.archivedThreadsSnapshot()]) {
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "thread-1", name: "Renamed thread", isPinned: true }),
            expect.objectContaining({ id: "unrelated", name: null }),
          ]),
        );
        expect(rows?.find((row) => row.id === "unrelated")?.isPinned).not.toBe(true);
      }
      expect(firstRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
      expect(secondRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
      expect(firstRefresh).not.toHaveBeenCalled();
      expect(secondRefresh).not.toHaveBeenCalled();
      expect(first.surface.openPanelSnapshot().threadId).toBe("thread-2");
      first.containerEl.querySelector<HTMLButtonElement>('[aria-label="Show thread list"]')?.click();
      await vi.waitFor(() => expect(first.containerEl.querySelector('[aria-label="Unpin thread"]')).not.toBeNull());
    } finally {
      await first.onClose();
      await second.onClose();
      plugin.runtime.reset();
    }
  });

  it("keeps shared thread list refreshes separate across app-server cache contexts", async () => {
    const firstThreads = deferred<Thread[]>();
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-a");
    contextConnectionClientMock.mockImplementation(() =>
      threadListClient(() => (plugin.settings.codexPath === "codex-a" ? firstThreads.promise : Promise.resolve([thread("second")]))),
    );

    const first = threadCatalog(plugin).refreshActiveThreads();
    await flushMicrotasks();
    await publishCodexPath(plugin, "codex-b");
    await expect(first).rejects.toThrow("Codex execution runtime is no longer active.");
    const second = threadCatalog(plugin).refreshActiveThreads();
    await flushMicrotasks();

    expect(contextConnectionClientMock).toHaveBeenCalledTimes(2);
    expect(contextConnectionClientMock).toHaveBeenNthCalledWith(1, "codex-a", "/vault");
    expect(contextConnectionClientMock).toHaveBeenNthCalledWith(2, "codex-b", "/vault");
    await second;
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("second")]);

    firstThreads.resolve([thread("first")]);
    await flushMicrotasks();
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("second")]);
    await publishCodexPath(plugin, "codex-a");
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toBeNull();
  });

  it("persists the new context before restarting its runtime", async () => {
    const plugin = await pluginWithLeaves([]);
    const firstContext = currentChatHost(plugin).appServerContext;
    const save = deferred<void>();
    const saveSettings = vi.spyOn(plugin, "saveSettings").mockReturnValue(save.promise);

    const publication = plugin.runtime.settingTabHost().publishSettings({ ...plugin.settings, codexPath: "codex-next" });
    await Promise.resolve();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ codexPath: "codex-next" }));
    expect(plugin.settings.codexPath).toBe(firstContext.codexPath);
    expect(currentChatHost(plugin).appServerContext).toBe(firstContext);

    save.resolve(undefined);
    await publication;

    expect(plugin.settings.codexPath).toBe("codex-next");
    expect(currentChatHost(plugin).appServerContext).toEqual({ codexPath: "codex-next", vaultPath: "/vault" });
    expect(currentChatHost(plugin).appServerContext).not.toBe(firstContext);
  });

  it("keeps the active settings and runtime when saving fails and allows a later retry", async () => {
    const plugin = await pluginWithLeaves([]);
    const previousSettings = { ...plugin.settings };
    const previousContext = currentChatHost(plugin).appServerContext;
    const saveData = vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);

    await expect(publishCodexPath(plugin, "codex-next")).rejects.toThrow("disk full");

    expect(saveData).toHaveBeenCalledWith(expect.objectContaining({ codexPath: "codex-next" }));
    expect(plugin.settings).toEqual(previousSettings);
    expect(currentChatHost(plugin).appServerContext).toBe(previousContext);

    await publishCodexPath(plugin, "codex-next");

    expect(plugin.settings.codexPath).toBe("codex-next");
    expect(currentChatHost(plugin).appServerContext).toEqual({ codexPath: "codex-next", vaultPath: "/vault" });
    expect(saveData).toHaveBeenCalledTimes(2);
  });

  it("automatically connects an empty panel after correcting an executable that failed on startup", async () => {
    notices.length = 0;
    const client = connectedClient();
    failInitialExecutable(client);
    const leaves: TestLeaf[] = [];
    const plugin = await pluginWithLeaves(leaves);
    const panelLeaf = leaf();
    const view = attachTestPanel(plugin, panelLeaf);
    leaves.push(panelLeaf);
    try {
      await view.onOpen();
      await vi.waitFor(() => expect(view.containerEl.textContent).toContain("initial executable failed"));
      expect(client.request).not.toHaveBeenCalled();
      expect(notices).toContain("Codex app-server connection failed.");

      await publishCodexPath(plugin, "corrected-codex");
      await vi.waitFor(() => expect(client.request).toHaveBeenCalledWith("config/read", expect.anything()));

      expect(contextConnectionClientMock).toHaveBeenCalledWith("corrected-codex", "/vault");
      expect(view.containerEl.textContent).not.toContain("initial executable failed");
      expect(view.getState()).toEqual({ version: 1 });
    } finally {
      notices.length = 0;
    }
  });

  it("automatically resumes the foreground restored thread after correcting a failed executable", async () => {
    notices.length = 0;
    const client = connectedClient({
      "thread/resume": vi.fn((params: unknown) => Promise.resolve(resumedThread((params as { threadId: string }).threadId))),
      "thread/turns/list": vi.fn().mockResolvedValue({ data: [completedTurn("saved-turn")], nextCursor: null }),
    });
    failInitialExecutable(client);
    const leaves: TestLeaf[] = [];
    const plugin = await pluginWithLeaves(leaves);
    const foregroundLeaf = leaf();
    const backgroundLeaf = leaf();
    const foreground = chatView(CodexChatView, foregroundLeaf, plugin.runtime);
    const background = chatView(CodexChatView, backgroundLeaf, plugin.runtime);
    foregroundLeaf.view = foreground;
    backgroundLeaf.view = background;
    leaves.push(foregroundLeaf, backgroundLeaf);
    (plugin.app.workspace.getActiveViewOfType as ReturnType<typeof vi.fn>).mockReturnValue(foreground);
    try {
      await foreground.setState({ threadId: "foreground", threadTitle: "Saved foreground" }, {} as never);
      await background.setState({ threadId: "background", threadTitle: "Saved background" }, {} as never);
      await foreground.onOpen();
      await background.onOpen();
      plugin.runtime.activeWorkspaceLeafChanged(foregroundLeaf as never);
      await vi.waitFor(() => expect(foreground.containerEl.textContent).toContain("initial executable failed"));
      expect(foreground.getState()).toMatchObject({ threadId: "foreground", threadTitle: "Saved foreground" });

      await publishCodexPath(plugin, "corrected-codex");
      await vi.waitFor(() => {
        const roles = [...foreground.containerEl.querySelectorAll(".codex-panel__stream-item-role")].map((element) => element.textContent);
        expect(roles).toEqual(["You", "Codex"]);
      });

      expect(contextConnectionClientMock).toHaveBeenCalledWith("corrected-codex", "/vault");
      expect(foreground.getState()).toMatchObject({ threadId: "foreground" });
      expect(background.getState()).toMatchObject({ threadId: "background", threadTitle: "Saved background" });
      expect(client.request.mock.calls.filter(([method]) => method === "thread/resume")).toEqual([
        ["thread/resume", expect.objectContaining({ threadId: "foreground" }), expect.anything()],
      ]);
      expect(client.request).toHaveBeenCalledWith("thread/turns/list", expect.objectContaining({ threadId: "foreground" }));
      expect(foreground.containerEl.textContent).not.toContain("initial executable failed");
    } finally {
      await foreground.onClose();
      await background.onClose();
      plugin.runtime.reset();
      notices.length = 0;
    }
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending old initialization that later %ss after the executable is corrected",
    async (outcome) => {
      notices.length = 0;
      const oldInitialization = deferred<{ codexHome: string; platformFamily: string; platformOs: string; userAgent: string }>();
      const nextClient = connectedClient();
      const oldClient = connectedClient();
      const starts: string[] = [];
      vi.spyOn(contextConnection, "AppServerContextConnection").mockImplementation(
        class extends ActualContextConnection {
          constructor(...args: ConstructorParameters<typeof ActualContextConnection>) {
            let client: AppServerClient | null = null;
            super(args[0], args[1], args[2], args[3], {
              connect: async () => {
                starts.push(args[0]);
                if (args[0] === "codex") {
                  const result = await oldInitialization.promise;
                  client = oldClient as unknown as AppServerClient;
                  return result;
                }
                client = nextClient as unknown as AppServerClient;
                return { codexHome: "/new", platformFamily: "unix", platformOs: "macos", userAgent: "new" };
              },
              currentClient: () => client,
              disconnect: () => {
                client = null;
              },
            });
          }
        },
      );
      const leaves: TestLeaf[] = [];
      const plugin = await pluginWithLeaves(leaves);
      const panelLeaf = leaf();
      const view = attachTestPanel(plugin, panelLeaf);
      leaves.push(panelLeaf);
      try {
        await view.onOpen();
        await vi.waitFor(() => expect(starts).toContain("codex"));
        await publishCodexPath(plugin, "corrected-codex");
        await vi.waitFor(() => expect(nextClient.request).toHaveBeenCalledWith("config/read", expect.anything()));
        if (outcome === "resolve") {
          oldInitialization.resolve({ codexHome: "/old", platformFamily: "unix", platformOs: "macos", userAgent: "old" });
        } else {
          oldInitialization.reject(new Error("late old startup failure"));
        }
        await flushMicrotasks();

        expect(view.containerEl.textContent).not.toContain("late old startup failure");
        expect(notices).not.toContain("Codex app-server connection failed.");
        view.surface.setComposerText("Continue after correcting the executable");
        await submitComposerByEnter(view);
        await vi.waitFor(() =>
          expect(nextClient.request).toHaveBeenCalledWith("turn/start", expect.objectContaining({ threadId: "thread-new" })),
        );
        expect(oldClient.request).not.toHaveBeenCalled();
      } finally {
        notices.length = 0;
      }
    },
  );

  it("retires both pending and queued preference writes when the workspace is reset", async () => {
    const plugin = await pluginWithLeaves([]);
    const host = plugin.runtime.settingTabHost();
    const write = deferred<void>();
    const save = vi.spyOn(plugin, "saveSettings").mockReturnValue(write.promise);
    const prefs = { ...plugin.settings, showToolbar: false };
    const pending = host.publishSettings(prefs);
    plugin.runtime.reset();
    plugin.runtime.initialize();
    await expect(host.publishSettings(prefs)).rejects.toThrow("runtime reset");
    write.resolve();
    await expect(pending).rejects.toThrow("runtime reset");
    expect(save).toHaveBeenCalledOnce();
    expect(plugin.runtime.settingTabHost().settings.showToolbar).toBe(true);
    plugin.runtime.reset();
  });

  it("does not resurrect a replacement after the runtime is reset", async () => {
    const save = deferred<void>();
    const plugin = await pluginWithLeaves([]);
    vi.spyOn(plugin, "saveSettings").mockReturnValue(save.promise);

    const publication = publishCodexPath(plugin, "codex-next");
    await Promise.resolve();
    plugin.runtime.reset();
    save.resolve(undefined);

    await expect(publication).rejects.toThrow("runtime reset");
    expect(plugin.settings.codexPath).toBe("codex");
    expect(plugin.saveSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ codexPath: "codex-next" }));
  });

  it("does not publish a replacement after a synchronous reset during view detachment", async () => {
    let plugin!: CodexPanelPlugin;
    let detached = false;
    const attachRuntime = vi.fn();
    const runtimeView = Object.assign(Object.create(CodexChatView.prototype), {
      attachRuntime,
      detachRuntime: vi.fn(() => {
        if (detached) return Promise.resolve();
        detached = true;
        plugin.runtime.reset();
        return Promise.reject(new Error("cleanup failed"));
      }),
      isRuntimeAttached: () => !detached,
    }) as ChatRuntimeView;
    const runtimeLeaf = leaf();
    runtimeLeaf.view = runtimeView;
    plugin = await pluginWithLeaves([runtimeLeaf]);
    plugin.runtime.attachChatView(runtimeView);
    attachRuntime.mockClear();

    await expect(publishCodexPath(plugin, "codex-next")).rejects.toThrow("runtime reset");

    expect(plugin.settings.codexPath).toBe("codex");
    expect(attachRuntime).not.toHaveBeenCalled();
  });

  it.each([
    { action: "reset", removed: true, stage: "fork" },
    { action: "replace", removed: false, stage: "start" },
  ] as const)(
    "retires its context without interrupting temporary work ($action, prior close=$removed, $stage)",
    async ({ action, removed, stage }) => {
      const forked = deferred<unknown>();
      const started = deferred<unknown>();
      const contexts: { client: ReturnType<typeof connectedClient>; disconnect: ReturnType<typeof vi.fn> }[] = [];
      vi.spyOn(contextConnection, "AppServerContextConnection").mockImplementation(
        class extends ActualContextConnection {
          constructor(...args: ConstructorParameters<typeof ActualContextConnection>) {
            const client = connectedClient({
              ...(stage === "fork" ? { "thread/fork": vi.fn(() => forked.promise) } : {}),
              ...(stage === "start" ? { "turn/start": vi.fn(() => started.promise) } : {}),
            });
            const disconnect = vi.fn();
            super(args[0], args[1], args[2], args[3], {
              connect: async () => ({ codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "macos", userAgent: "test" }),
              currentClient: () => client as unknown as AppServerClient,
              disconnect,
            });
            contexts.push({ client, disconnect });
          }
        },
      );
      const leaves: TestLeaf[] = [];
      const plugin = await pluginWithLeaves(leaves);
      const panelLeaf = leaf();
      const view = attachTestPanel(plugin, panelLeaf);
      leaves.push(panelLeaf);
      await view.onOpen();
      const opening = view.surface.applyForkDraft(sideChatDraft("source", "Source"), "A side question");
      const original = contexts[0];
      if (!original) throw new Error("Expected the original context.");
      await waitForAsyncWork(() =>
        expect(original.client.request).toHaveBeenCalledWith(stage === "fork" ? "thread/fork" : "turn/start", expect.anything()),
      );
      const closing = removed ? view.onClose() : null;
      if (removed) leaves.length = 0;
      if (action === "replace") await publishCodexPath(plugin, "codex-next");
      else plugin.runtime.reset();
      expect(original.disconnect).toHaveBeenCalledOnce();
      const replacementSnapshot = action === "replace" ? view.surface.openPanelSnapshot() : null;
      const requestCount = original.client.request.mock.calls.length;
      if (stage === "fork") forked.resolve({ thread: thread("late-side") });
      else started.resolve({ turn: { id: "late-turn" } });
      await closing;
      await expect(opening).resolves.toBe(stage === "start");
      expect(action === "replace" ? view.surface.openPanelSnapshot() : null).toEqual(replacementSnapshot);
      expect(original.client.request.mock.calls.length).toBe(requestCount);
      expect(original.client.request.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
      expect(plugin.settings.codexPath).toBe(action === "replace" ? "codex-next" : "codex");
      expect(view.isRuntimeAttached()).toBe(action === "replace" && !removed);
      for (const replacement of contexts.slice(1)) expect(replacement.disconnect).not.toHaveBeenCalled();
    },
  );

  it("detaches and reattaches every open Threads view to the new execution runtime", async () => {
    const attachRuntime = vi.fn();
    const detachRuntime = vi.fn();
    const runtimeView = Object.assign(Object.create(CodexThreadsView.prototype), { attachRuntime, detachRuntime });
    const runtimeLeaf = leaf();
    runtimeLeaf.view = runtimeView;
    const plugin = await pluginWithLeaves([], { threadsLeaves: [runtimeLeaf] });
    plugin.runtime.attachThreadsView(runtimeView);
    const previousMutations = attachRuntime.mock.calls[0]?.[0].threadMutations;
    attachRuntime.mockClear();

    await publishCodexPath(plugin, "codex-next");

    expect(detachRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime.mock.calls[0]?.[0].threadMutations).not.toBe(previousMutations);
  });

  it("cancels selection rewrites before publishing a new app-server context", async () => {
    const plugin = await pluginWithLeaves([]);
    const pathsAtClose: string[] = [];
    const closeAll = vi.fn(() => {
      pathsAtClose.push(plugin.settings.codexPath);
    });
    plugin.runtime.setSelectionRewriteController({ closeAll });

    await publishCodexPath(plugin, "codex-next");

    expect(pathsAtClose).toEqual(["codex"]);
    expect(currentChatHost(plugin).appServerContext.codexPath).toBe("codex-next");
  });

  it.each(["showToolbar", "newConversationsEphemeral"] as const)("refreshes only chat settings when %s changes", async (key) => {
    const { plugin, refreshChat, refreshThreads } = await settingsSurfaces();

    await plugin.runtime.settingTabHost().publishSettings({ ...plugin.settings, [key]: !plugin.settings[key] });

    expect(refreshChat).toHaveBeenCalledOnce();
    expect(refreshThreads).not.toHaveBeenCalled();
  });

  it("refreshes chat and Threads settings when the archive default changes", async () => {
    const { plugin, refreshChat, refreshThreads } = await settingsSurfaces();

    await plugin.runtime
      .settingTabHost()
      .publishSettings({ ...plugin.settings, archiveExportEnabled: !plugin.settings.archiveExportEnabled });

    expect(refreshChat).toHaveBeenCalledOnce();
    expect(refreshThreads).toHaveBeenCalledOnce();
  });
});

async function settingsSurfaces() {
  const chatLeaf = leaf();
  const view = chatView(CodexChatView, chatLeaf);
  chatLeaf.view = view;
  const refreshChat = vi.spyOn(view.surface, "refreshSettings");
  const threadsView = Object.create(CodexThreadsView.prototype) as InstanceType<typeof CodexThreadsView>;
  const refreshThreads = vi.spyOn(threadsView, "refreshSettings");
  const threadsLeaf = leaf();
  threadsLeaf.view = threadsView;
  const plugin = await pluginWithLeaves([chatLeaf], { threadsLeaves: [threadsLeaf] });
  onTestFinished(async () => {
    await view.onClose();
    plugin.runtime.reset();
  });
  return { plugin, refreshChat, refreshThreads };
}

async function twoAvailablePanels() {
  contextConnectionClientMock.mockReturnValue(connectedClient());
  const firstLeaf = leaf();
  const secondLeaf = leaf();
  const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);
  const first = attachTestPanel(plugin, firstLeaf);
  const second = attachTestPanel(plugin, secondLeaf);
  await first.onOpen();
  return { first, second, workspace: currentChatHost(plugin).workspace };
}

function attachTestPanel(plugin: CodexPanelPlugin, target: TestLeaf) {
  const view = chatView(CodexChatView, target, plugin.runtime);
  target.view = view;
  onTestFinished(async () => {
    await view.onClose();
    plugin.runtime.reset();
  });
  return view;
}

function failInitialExecutable(client: ReturnType<typeof connectedClient>): void {
  contextConnectionClientMock.mockImplementation((codexPath: string) => {
    if (codexPath === "codex") throw new Error("initial executable failed");
    return client as unknown as AppServerClient;
  });
}
