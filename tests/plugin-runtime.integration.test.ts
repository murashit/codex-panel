// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Thread } from "../src/domain/threads/model";
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
  return plugin.runtime.chatHost().threadCatalog;
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
    const firstArchived = vi.spyOn((firstLeaf.view as CodexChatView).surface, "applyThreadArchived").mockImplementation(() => undefined);
    const firstRefresh = vi.spyOn((firstLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const secondLeaf = leaf();
    secondLeaf.view = chatView(CodexChatView, secondLeaf);
    const secondArchived = vi.spyOn((secondLeaf.view as CodexChatView).surface, "applyThreadArchived").mockImplementation(() => undefined);
    const secondRefresh = vi.spyOn((secondLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([firstLeaf, secondLeaf]);

    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(firstArchived).toHaveBeenCalledWith("thread-1");
    expect(secondArchived).toHaveBeenCalledWith("thread-1");
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).not.toHaveBeenCalled();
  });

  it("keeps catalog archive notifications separate from explicit panel close requests", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const restoredMatchingLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored" } });
    const matchingLeaf = leaf();
    matchingLeaf.view = chatView(CodexChatView, matchingLeaf);
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-1" }));
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-2" }));
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([restoredMatchingLeaf, matchingLeaf, otherLeaf]);

    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(restoredMatchingLeaf.detach).not.toHaveBeenCalled();
    expect(matchingLeaf.detach).not.toHaveBeenCalled();
    expect(otherLeaf.detach).not.toHaveBeenCalled();

    plugin.runtime.threadsHost().closeOpenPanelsForThread("thread-1");

    expect(restoredMatchingLeaf.detach).toHaveBeenCalledOnce();
    expect(matchingLeaf.detach).toHaveBeenCalledOnce();
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

    threadCatalog(plugin).apply({ type: "thread-renamed", threadId: "thread-1", name: "Renamed thread" });

    expect(firstRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
    expect(secondRenamed).toHaveBeenCalledWith("thread-1", "Renamed thread");
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).not.toHaveBeenCalled();
  });

  it("keeps shared thread list refreshes separate across app-server cache contexts", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    vi.spyOn(connectedView.surface, "canServeAppServerContext").mockReturnValue(true);
    let resolveFirst!: (threads: Thread[]) => void;
    const runWithAppServerClient = vi.spyOn(connectedView.surface, "runWithAppServerClient");
    const plugin = await pluginWithLeaves([connectedLeaf]);
    await publishCodexPath(plugin, "codex-a");
    runWithAppServerClient.mockImplementation((operation) =>
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

    const first = threadCatalog(plugin).refreshActive();
    const staleFirst = expect(first).rejects.toThrow("Codex app-server resource context changed while loading.");
    await flushMicrotasks();
    await publishCodexPath(plugin, "codex-b");
    const second = threadCatalog(plugin).refreshActive();
    await flushMicrotasks();

    expect(runWithAppServerClient).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual([thread("second")]);
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("second")]);

    resolveFirst([thread("first")]);
    await staleFirst;
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("second")]);
    await publishCodexPath(plugin, "codex-a");
    expect(threadCatalog(plugin).activeSnapshot()).toBeNull();
  });

  it("does not reuse a connected panel whose app-server context does not match the shared query", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    vi.spyOn(connectedView.surface, "canServeAppServerContext").mockReturnValue(false);
    const runWithAppServerClient = vi.spyOn(connectedView.surface, "runWithAppServerClient").mockResolvedValue([thread("wrong-context")]);
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: ReturnType<typeof threadListClient>) => Promise<unknown>) =>
        operation(threadListClient(() => Promise.resolve([thread("matching-context")]))),
    );
    const plugin = await pluginWithLeaves([connectedLeaf]);
    await publishCodexPath(plugin, "codex-b");

    await expect(threadCatalog(plugin).refreshActive()).resolves.toEqual([thread("matching-context")]);

    expect(runWithAppServerClient).not.toHaveBeenCalled();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledWith("codex-b", "/vault", expect.any(Function), {});
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("matching-context")]);
  });

  it("uses a short-lived client when the operation declares an unhandled server-request policy", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ viewId: "connected", connected: true }));
    const runWithAppServerClient = vi.spyOn(connectedView.surface, "runWithAppServerClient").mockResolvedValue("chat-result");
    const shortLivedClient = { request: vi.fn().mockResolvedValue({}) };
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: typeof shortLivedClient) => Promise<unknown>) =>
        operation(shortLivedClient),
    );
    const plugin = await pluginWithLeaves([connectedLeaf]);
    plugin.settings.codexPath = "codex";

    const result = await plugin.runtime.withClient((client) => client.request("config/read", { cwd: "/vault", includeLayers: true }), {
      serverRequests: { kind: "reject", message: "Settings refresh does not handle server requests." },
    });

    expect(result).toEqual({});
    expect(runWithAppServerClient).not.toHaveBeenCalled();
    expect(withShortLivedAppServerClientMock).toHaveBeenCalledWith("codex", "/vault", expect.any(Function), {
      serverRequests: { kind: "reject", message: "Settings refresh does not handle server requests." },
    });
    expect(shortLivedClient.request).toHaveBeenCalledWith("config/read", { cwd: "/vault", includeLayers: true });
  });

  it("rejects a connected-panel result when the app-server context changes during the operation", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const connectedLeaf = leaf();
    connectedLeaf.view = chatView(CodexChatView, connectedLeaf);
    const connectedView = connectedLeaf.view as CodexChatView;
    vi.spyOn(connectedView.surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ connected: true }));
    vi.spyOn(connectedView.surface, "canServeAppServerContext").mockReturnValue(true);
    const result = deferred<string>();
    vi.spyOn(connectedView.surface, "runWithAppServerClient").mockReturnValue(result.promise);
    const plugin = await pluginWithLeaves([connectedLeaf]);
    await publishCodexPath(plugin, "codex-a");

    const operation = plugin.runtime.withClient(() => Promise.resolve("unused"));
    await publishCodexPath(plugin, "codex-b");
    result.resolve("stale-result");

    await expect(operation).rejects.toThrow("Codex app-server resource context changed while loading.");
  });

  it("rejects a short-lived result when the app-server context changes during the operation", async () => {
    const result = deferred<string>();
    withShortLivedAppServerClientMock.mockReturnValue(result.promise);
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-a");

    const operation = plugin.runtime.withClient(() => Promise.resolve("unused"), {
      serverRequests: { kind: "reject", message: "test" },
    });
    await publishCodexPath(plugin, "codex-b");
    result.resolve("stale-result");

    await expect(operation).rejects.toThrow("Codex app-server resource context changed while loading.");
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

    const operation = plugin.runtime.withClient(callback, {
      serverRequests: { kind: "reject", message: "test" },
    });
    await publishCodexPath(plugin, "codex-b");
    clientReady.resolve();

    await expect(operation).rejects.toThrow("Codex app-server resource context changed while loading.");
    expect(callback).not.toHaveBeenCalled();
    expect(shortLivedClient.request).not.toHaveBeenCalled();
  });

  it("publishes a persisted context and its new resource lease atomically", async () => {
    const plugin = await pluginWithLeaves([]);
    const firstLease = plugin.runtime.appServerContextLease();
    const save = deferred<void>();
    const saveSettings = vi.spyOn(plugin, "saveSettings").mockReturnValue(save.promise);

    const publication = plugin.runtime.settingTabHost().publishSettings({ ...plugin.settings, codexPath: "codex-next" });
    await Promise.resolve();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ codexPath: "codex-next" }));
    expect(plugin.settings.codexPath).toBe(firstLease.context.codexPath);
    expect(plugin.runtime.appServerContextLease()).toBe(firstLease);

    save.resolve(undefined);
    await publication;

    expect(plugin.settings.codexPath).toBe("codex-next");
    expect(plugin.runtime.appServerContextLease()).toEqual({
      context: { codexPath: "codex-next", vaultPath: "/vault" },
      generation: firstLease.generation + 1,
    });
  });

  it("coordinates context replacement with every open Threads view", async () => {
    const { CodexThreadsView } = await import("../src/features/threads-view/view.obsidian");
    const prepareAppServerContextChange = vi.fn();
    const refreshSettings = vi.fn();
    const threadsView = Object.assign(Object.create(CodexThreadsView.prototype), {
      prepareAppServerContextChange,
      refreshSettings,
    }) as InstanceType<typeof CodexThreadsView>;
    const threadsLeaf = leaf();
    threadsLeaf.view = threadsView;
    const plugin = await pluginWithLeaves([], { threadsLeaves: [threadsLeaf] });
    await publishCodexPath(plugin, "codex-next");
    expect(prepareAppServerContextChange).toHaveBeenCalledOnce();
    expect(refreshSettings).toHaveBeenCalledOnce();
  });

  it("cancels selection rewrites before publishing a new app-server context", async () => {
    const plugin = await pluginWithLeaves([]);
    const closeAll = vi.fn();
    plugin.runtime.setSelectionRewriteController({ closeAll });

    await publishCodexPath(plugin, "codex-next");

    expect(closeAll).toHaveBeenCalledOnce();
  });
});
