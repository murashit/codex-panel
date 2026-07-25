// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL } from "../src/constants";
import type { Thread } from "../src/domain/threads/model";
import type { ChatRuntimeView, CodexChatHost } from "../src/features/chat/host/contracts";
import type { CodexChatView } from "../src/features/chat/host/view.obsidian";
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
  thread,
  threadListClient,
} from "./support/plugin-fixtures";

installObsidianDomShims();

const { withShortLivedAppServerClientMock } = vi.hoisted(() => ({
  withShortLivedAppServerClientMock: vi.fn(),
}));

vi.mock("../src/app-server/connection/short-lived-client", () => ({
  withShortLivedAppServerClient: withShortLivedAppServerClientMock,
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
    const view: ChatRuntimeView = {
      attachRuntime: (host) => {
        createdCapture.current = host;
      },
      activateRuntime: () => undefined,
      detachRuntime: () => {
        createdCapture.current = null;
      },
    };
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
    withShortLivedAppServerClientMock.mockReset();
  });

  it("applies known archive mutations to open chat surfaces", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
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
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
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
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
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
    withShortLivedAppServerClientMock.mockImplementation(
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
    const staleFirst = expect(first).rejects.toThrow("Codex execution runtime was disposed while work was in progress.");
    await flushMicrotasks();
    await publishCodexPath(plugin, "codex-b");
    const second = threadCatalog(plugin).refreshActiveThreads();
    await flushMicrotasks();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual([thread("second")]);
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("second")]);

    resolveFirst([thread("first")]);
    await staleFirst;
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("second")]);
    await publishCodexPath(plugin, "codex-a");
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toBeNull();
  });

  it("runs shared queries through a runtime-owned short-lived client", async () => {
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: ReturnType<typeof threadListClient>) => Promise<unknown>) =>
        operation(threadListClient(() => Promise.resolve([thread("matching-context")]))),
    );
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-b");

    await expect(threadCatalog(plugin).refreshActiveThreads()).resolves.toEqual([thread("matching-context")]);

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledWith(
      "codex-b",
      "/vault",
      expect.any(Function),
      {},
      expect.objectContaining({ created: expect.any(Function), disposed: expect.any(Function) }),
    );
    expect(threadCatalog(plugin).activeThreadsSnapshot()).toEqual([thread("matching-context")]);
  });

  it("uses a short-lived client when the operation declares an unhandled server-request policy", async () => {
    const shortLivedClient = { request: vi.fn().mockResolvedValue({}) };
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: typeof shortLivedClient) => Promise<unknown>) =>
        operation(shortLivedClient),
    );
    const plugin = await pluginWithLeaves([]);
    plugin.settings.codexPath = "codex";

    const result = await currentChatHost(plugin).appServerClientAccess.withClient(
      (client) => client.request("config/read", { cwd: "/vault", includeLayers: true }),
      {
        serverRequests: { kind: "reject", message: "Settings refresh does not handle server requests." },
      },
    );

    expect(result).toEqual({});
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledWith(
      "codex",
      "/vault",
      expect.any(Function),
      {
        serverRequests: { kind: "reject", message: "Settings refresh does not handle server requests." },
      },
      expect.objectContaining({ created: expect.any(Function), disposed: expect.any(Function) }),
    );
    expect(shortLivedClient.request).toHaveBeenCalledWith("config/read", { cwd: "/vault", includeLayers: true });
  });

  it("does not start a short-lived operation when its app-server context changes while connecting", async () => {
    const clientReady = deferred<void>();
    const shortLivedClient = { request: vi.fn().mockResolvedValue({}) };
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: typeof shortLivedClient) => Promise<unknown>) =>
        clientReady.promise.then(() => operation(shortLivedClient)),
    );
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-a");
    const callback = vi.fn(() => Promise.resolve("unused"));

    const operation = currentChatHost(plugin).appServerClientAccess.withClient(callback, {
      serverRequests: { kind: "reject", message: "test" },
    });
    await publishCodexPath(plugin, "codex-b");
    clientReady.resolve();

    await expect(operation).rejects.toThrow("Codex execution runtime was disposed while work was in progress.");
    expect(callback).not.toHaveBeenCalled();
    expect(shortLivedClient.request).not.toHaveBeenCalled();
  });

  it("publishes a persisted context and its replacement runtime atomically", async () => {
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

  it("detaches and reattaches every open Chat view to the new execution runtime", async () => {
    const attachRuntime = vi.fn();
    const activateRuntime = vi.fn();
    const detachRuntime = vi.fn();
    const plugin = await pluginWithLeaves([]);
    plugin.runtime.attachChatView({ attachRuntime, activateRuntime, detachRuntime });
    attachRuntime.mockClear();
    activateRuntime.mockClear();

    await publishCodexPath(plugin, "codex-next");

    expect(detachRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime).toHaveBeenCalledOnce();
    expect(activateRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime.mock.calls[0]?.[0].appServerContext.codexPath).toBe("codex-next");
    expect(attachRuntime.mock.calls[0]?.[0].appServerContext.vaultPath).toBe("/vault");
  });

  it("detaches and reattaches every open Threads view to the new execution runtime", async () => {
    const attachRuntime = vi.fn();
    const activateRuntime = vi.fn();
    const detachRuntime = vi.fn();
    const plugin = await pluginWithLeaves([]);
    plugin.runtime.attachThreadsView({ attachRuntime, activateRuntime, detachRuntime });
    attachRuntime.mockClear();
    activateRuntime.mockClear();

    await publishCodexPath(plugin, "codex-next");

    expect(detachRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime).toHaveBeenCalledOnce();
    expect(activateRuntime).toHaveBeenCalledOnce();
    expect(attachRuntime.mock.calls[0]?.[0].vaultPath).toBe("/vault");
  });

  it("cancels selection rewrites before publishing a new app-server context", async () => {
    const plugin = await pluginWithLeaves([]);
    const closeAll = vi.fn();
    plugin.runtime.setSelectionRewriteController({ closeAll });

    await publishCodexPath(plugin, "codex-next");

    expect(closeAll).toHaveBeenCalledOnce();
  });

  it("refreshes only chat settings when toolbar visibility changes", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const chatLeaf = leaf();
    chatLeaf.view = chatView(CodexChatView, chatLeaf);
    const refreshChat = vi.spyOn((chatLeaf.view as CodexChatView).surface, "refreshSettings");
    const plugin = await pluginWithLeaves([chatLeaf]);

    await plugin.runtime.settingTabHost().publishSettings({ ...plugin.settings, showToolbar: !plugin.settings.showToolbar });

    expect(refreshChat).toHaveBeenCalledOnce();
  });

  it("refreshes chat and Threads settings when the archive default changes", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const { CodexThreadsView } = await import("../src/features/threads-view/view.obsidian");
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
