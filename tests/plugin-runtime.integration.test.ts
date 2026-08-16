// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL, VIEW_TYPE_CODEX_TURN_DIFF } from "../src/constants";
import type { Thread } from "../src/domain/threads/model";
import type { ChatRuntimeView, CodexChatHost } from "../src/features/chat/host/contracts";
import { CodexChatView } from "../src/features/chat/host/view.obsidian";
import { CodexThreadsView } from "../src/features/threads-view/view.obsidian";
import { CodexTurnDiffView } from "../src/features/turn-diff/view.obsidian";
import type CodexPanelPlugin from "../src/main";
import { deferred } from "./support/async";
import { installObsidianDomShims } from "./support/dom";
import {
  chatView,
  flushMicrotasks,
  leaf,
  panelSnapshot,
  pluginWithLeaves,
  publishCodexPath,
  type TestLeaf,
  thread,
  threadListClient,
} from "./support/plugin-fixtures";

installObsidianDomShims();

const { contextConnectionClientMock } = vi.hoisted(() => ({
  contextConnectionClientMock: vi.fn(),
}));

vi.mock("../src/app-server/connection/context-connection", () => ({
  AppServerContextConnection: class {
    constructor(
      private readonly codexPath: string,
      private readonly cwd: string,
    ) {}

    withClient(operation: unknown) {
      return contextConnectionClientMock(this.codexPath, this.cwd, operation);
    }

    createLease() {
      throw new Error("Unexpected panel connection lease.");
    }

    dispose() {}
  },
}));

function threadCatalog(plugin: CodexPanelPlugin) {
  return currentChatHost(plugin).threadCatalog;
}

function threadFacts(plugin: CodexPanelPlugin) {
  return currentChatHost(plugin).threadFacts;
}

const capturedChatHosts = new WeakMap<CodexPanelPlugin, { current: CodexChatHost | null }>();

function currentChatHost(plugin: CodexPanelPlugin): CodexChatHost {
  let capture = capturedChatHosts.get(plugin);
  if (!capture) {
    const createdCapture = { current: null as CodexChatHost | null };
    const view = Object.assign(Object.create(CodexChatView.prototype), {
      session: null,
      attachRuntime: (host: CodexChatHost) => {
        createdCapture.current = host;
      },
      detachRuntime: () => {
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

  it("applies known archive mutations to open chat surfaces", async () => {
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
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    threadFacts(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(firstUnavailable).toHaveBeenCalledWith("thread-1");
    expect(secondUnavailable).toHaveBeenCalledWith("thread-1");
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).not.toHaveBeenCalled();
  });

  it("clears active and restored identities without detaching panel leaves", async () => {
    const restoredMatchingLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored" } });
    const matchingLeaf = leaf();
    matchingLeaf.view = chatView(CodexChatView, matchingLeaf);
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-1" }));
    const matchingUnavailable = vi
      .spyOn((matchingLeaf.view as CodexChatView).surface, "applyThreadUnavailable")
      .mockImplementation(() => undefined);
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-2" }));
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([restoredMatchingLeaf, matchingLeaf, otherLeaf]);

    threadFacts(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(matchingUnavailable).toHaveBeenCalledWith("thread-1");
    expect(restoredMatchingLeaf.detach).not.toHaveBeenCalled();
    expect(matchingLeaf.detach).not.toHaveBeenCalled();
    expect(otherLeaf.detach).not.toHaveBeenCalled();

    expect(restoredMatchingLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CODEX_PANEL,
      state: { version: 1 },
    });
    expect(matchingLeaf.detach).not.toHaveBeenCalled();
    expect(otherLeaf.detach).not.toHaveBeenCalled();
  });

  it("applies known rename mutations to open chat surfaces", async () => {
    const firstLeaf = leaf();
    firstLeaf.view = chatView(CodexChatView, firstLeaf);
    const firstRenamed = vi.spyOn((firstLeaf.view as CodexChatView).surface, "applyThreadRenamed").mockImplementation(() => undefined);
    const firstRefresh = vi.spyOn((firstLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondRenamed = vi.spyOn((secondLeaf.view as CodexChatView).surface, "applyThreadRenamed").mockImplementation(() => undefined);
    const secondRefresh = vi.spyOn((secondLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    threadFacts(plugin).apply({ type: "thread-renamed", threadId: "thread-1", name: "Renamed thread" });

    expect(firstRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
    expect(secondRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).not.toHaveBeenCalled();
  });

  it("keeps shared thread list refreshes separate across app-server cache contexts", async () => {
    let resolveFirst!: (threads: Thread[]) => void;
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-a");
    contextConnectionClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: ReturnType<typeof threadListClient>) => Promise<unknown>) =>
        operation(
          threadListClient(() =>
            plugin.settings.codexPath === "codex-a"
              ? new Promise<Thread[]>((resolve) => {
                  resolveFirst = resolve;
                })
              : Promise.resolve([thread("second")]),
          ),
        ),
    );

    const first = threadCatalog(plugin).refreshActiveThreads();
    const staleFirst = expect(first).rejects.toThrow("Codex execution runtime is no longer active.");
    await flushMicrotasks();
    await publishCodexPath(plugin, "codex-b");
    const second = threadCatalog(plugin).refreshActiveThreads();
    await flushMicrotasks();

    expect(contextConnectionClientMock).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual([thread("second")]);
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("second")]);

    resolveFirst([thread("first")]);
    await staleFirst;
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("second")]);
    await publishCodexPath(plugin, "codex-a");
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toBeNull();
  });

  it("runs shared queries through the runtime-owned context connection", async () => {
    contextConnectionClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: ReturnType<typeof threadListClient>) => Promise<unknown>) =>
        operation(threadListClient(() => Promise.resolve([thread("matching-context")]))),
    );
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-b");

    await expect(threadCatalog(plugin).refreshActiveThreads()).resolves.toEqual([thread("matching-context")]);

    expect(contextConnectionClientMock).toHaveBeenCalledWith("codex-b", "/vault", expect.any(Function));
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("matching-context")]);
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
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
    expect(plugin.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ codexPath: "codex-next" }));
  });

  it("detaches and reattaches every open Chat view to the new execution runtime", async () => {
    const attachRuntime = vi.fn();
    const detachRuntime = vi.fn();
    const runtimeView = Object.assign(Object.create(CodexChatView.prototype), {
      attachRuntime,
      detachRuntime,
      isRuntimeAttached: () => false,
    }) as ChatRuntimeView;
    const runtimeLeaf = leaf();
    runtimeLeaf.view = runtimeView;
    const plugin = await pluginWithLeaves([runtimeLeaf]);
    plugin.runtime.attachChatView(runtimeView);
    attachRuntime.mockClear();

    await publishCodexPath(plugin, "codex-next");

    expect(detachRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime.mock.calls[0]?.[0].appServerContext.codexPath).toBe("codex-next");
    expect(attachRuntime.mock.calls[0]?.[0].appServerContext.vaultPath).toBe("/vault");
  });

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
    const closeAll = vi.fn();
    plugin.runtime.setSelectionRewriteController({ closeAll });

    await publishCodexPath(plugin, "codex-next");

    expect(closeAll).toHaveBeenCalledOnce();
  });

  it("refreshes only chat settings when toolbar visibility changes", async () => {
    const chatLeaf = leaf();
    chatLeaf.view = chatView(CodexChatView, chatLeaf);
    const refreshChat = vi.spyOn((chatLeaf.view as CodexChatView).surface, "refreshSettings");
    const plugin = await pluginWithLeaves([chatLeaf]);

    await plugin.runtime.settingTabHost().publishSettings({ ...plugin.settings, showToolbar: !plugin.settings.showToolbar });

    expect(refreshChat).toHaveBeenCalledOnce();
  });

  it("refreshes chat and Threads settings when the archive default changes", async () => {
    const chatLeaf = leaf();
    chatLeaf.view = chatView(CodexChatView, chatLeaf);
    const refreshChat = vi.spyOn((chatLeaf.view as CodexChatView).surface, "refreshSettings");
    const threadsView = Object.create(CodexThreadsView.prototype) as InstanceType<typeof CodexThreadsView>;
    const refreshThreads = vi.spyOn(threadsView, "refreshSettings");
    const threadsLeaf = leaf();
    threadsLeaf.view = threadsView;
    const plugin = await pluginWithLeaves([chatLeaf], { threadsLeaves: [threadsLeaf] });

    await plugin.runtime
      .settingTabHost()
      .publishSettings({ ...plugin.settings, archiveExportEnabled: !plugin.settings.archiveExportEnabled });

    expect(refreshChat).toHaveBeenCalledOnce();
    expect(refreshThreads).toHaveBeenCalledOnce();
  });
});
