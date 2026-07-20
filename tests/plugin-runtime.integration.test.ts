// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { VIEW_TYPE_CODEX_PANEL } from "../src/constants";
import type { Thread } from "../src/domain/threads/model";
import type { CodexChatView } from "../src/features/chat/host/view.obsidian";
import type CodexPanelPlugin from "../src/main";
import { SwappableSettingsDynamicData } from "../src/plugin-runtime";
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

  it("clears active and restored identities without detaching panel leaves", async () => {
    const { CodexChatView } = await import("../src/features/chat/host/view.obsidian");
    const restoredMatchingLeaf = leaf({ state: { threadId: "thread-1", threadTitle: "Restored" } });
    const matchingLeaf = leaf();
    matchingLeaf.view = chatView(CodexChatView, matchingLeaf);
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-1" }));
    const matchingArchived = vi
      .spyOn((matchingLeaf.view as CodexChatView).surface, "applyThreadArchived")
      .mockImplementation(() => undefined);
    vi.spyOn((matchingLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const otherLeaf = leaf();
    otherLeaf.view = chatView(CodexChatView, otherLeaf);
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "openPanelSnapshot").mockReturnValue(panelSnapshot({ threadId: "thread-2" }));
    vi.spyOn((otherLeaf.view as CodexChatView).surface, "refreshSharedThreads").mockResolvedValue(undefined);
    const plugin = await pluginWithLeaves([restoredMatchingLeaf, matchingLeaf, otherLeaf]);

    threadCatalog(plugin).apply({ type: "thread-archived", threadId: "thread-1" });

    expect(matchingArchived).toHaveBeenCalledWith("thread-1");
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

    threadCatalog(plugin).apply({ type: "thread-renamed", threadId: "thread-1", name: "Renamed thread" });

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

    const first = threadCatalog(plugin).refreshActive();
    const staleFirst = expect(first).rejects.toThrow("Codex app-server resource context changed while loading.");
    await flushMicrotasks();
    await publishCodexPath(plugin, "codex-b");
    const second = threadCatalog(plugin).refreshActive();
    await flushMicrotasks();

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual([thread("second")]);
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("second")]);

    resolveFirst([thread("first")]);
    await staleFirst;
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("second")]);
    await publishCodexPath(plugin, "codex-a");
    expect(threadCatalog(plugin).activeSnapshot()).toBeNull();
  });

  it("runs shared queries through a runtime-owned short-lived client", async () => {
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: ReturnType<typeof threadListClient>) => Promise<unknown>) =>
        operation(threadListClient(() => Promise.resolve([thread("matching-context")]))),
    );
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-b");

    await expect(threadCatalog(plugin).refreshActive()).resolves.toEqual([thread("matching-context")]);

    expect(withShortLivedAppServerClientMock).toHaveBeenCalledWith(
      "codex-b",
      "/vault",
      expect.any(Function),
      {},
      expect.objectContaining({ created: expect.any(Function), disposed: expect.any(Function) }),
    );
    expect(threadCatalog(plugin).activeSnapshot()).toEqual([thread("matching-context")]);
  });

  it("uses a short-lived client when the operation declares an unhandled server-request policy", async () => {
    const shortLivedClient = { request: vi.fn().mockResolvedValue({}) };
    withShortLivedAppServerClientMock.mockImplementation(
      (_codexPath: string, _vaultPath: string, operation: (client: typeof shortLivedClient) => Promise<unknown>) =>
        operation(shortLivedClient),
    );
    const plugin = await pluginWithLeaves([]);
    plugin.settings.codexPath = "codex";

    const result = await plugin.runtime.withClient((client) => client.request("config/read", { cwd: "/vault", includeLayers: true }), {
      serverRequests: { kind: "reject", message: "Settings refresh does not handle server requests." },
    });

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

  it("rejects an old A result after switching from A to B and back to A", async () => {
    const result = deferred<string>();
    withShortLivedAppServerClientMock.mockReturnValue(result.promise);
    const plugin = await pluginWithLeaves([]);
    await publishCodexPath(plugin, "codex-a");

    const operation = plugin.runtime.withClient(() => Promise.resolve("unused"), {
      serverRequests: { kind: "reject", message: "test" },
    });
    await publishCodexPath(plugin, "codex-b");
    await publishCodexPath(plugin, "codex-a");
    result.resolve("stale-a");

    await expect(operation).rejects.toThrow("Codex app-server resource context changed while loading.");
    expect(plugin.runtime.chatHost().appServerContext).toEqual({ codexPath: "codex-a", vaultPath: "/vault" });
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

  it("publishes a persisted context and its replacement runtime atomically", async () => {
    const plugin = await pluginWithLeaves([]);
    const firstContext = plugin.runtime.chatHost().appServerContext;
    const save = deferred<void>();
    const saveSettings = vi.spyOn(plugin, "saveSettings").mockReturnValue(save.promise);

    const publication = plugin.runtime.settingTabHost().publishSettings({ ...plugin.settings, codexPath: "codex-next" });
    await Promise.resolve();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ codexPath: "codex-next" }));
    expect(plugin.settings.codexPath).toBe(firstContext.codexPath);
    expect(plugin.runtime.chatHost().appServerContext).toBe(firstContext);

    save.resolve(undefined);
    await publication;

    expect(plugin.settings.codexPath).toBe("codex-next");
    expect(plugin.runtime.chatHost().appServerContext).toEqual({ codexPath: "codex-next", vaultPath: "/vault" });
    expect(plugin.runtime.chatHost().appServerContext).not.toBe(firstContext);
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
    expect(attachRuntime.mock.calls[0]?.[0].settingsRef.settings.codexPath()).toBe("codex-next");
    expect(attachRuntime.mock.calls[0]?.[0].settingsRef.vaultPath).toBe("/vault");
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
    expect(attachRuntime.mock.calls[0]?.[0].settings.codexPath()).toBe("codex-next");
  });

  it("constructs every replacement session before activating any of them", async () => {
    let chatAttached = false;
    let threadsAttached = false;
    let verifyBatchActivation = false;
    const chat = {
      attachRuntime: vi.fn(() => {
        chatAttached = true;
      }),
      activateRuntime: vi.fn(() => {
        if (!verifyBatchActivation) return;
        expect(chatAttached).toBe(true);
        expect(threadsAttached).toBe(true);
      }),
      detachRuntime: vi.fn(() => {
        chatAttached = false;
      }),
    };
    const threads = {
      attachRuntime: vi.fn(() => {
        threadsAttached = true;
      }),
      activateRuntime: vi.fn(() => {
        if (!verifyBatchActivation) return;
        expect(chatAttached).toBe(true);
        expect(threadsAttached).toBe(true);
      }),
      detachRuntime: vi.fn(() => {
        threadsAttached = false;
      }),
    };
    const plugin = await pluginWithLeaves([]);
    plugin.runtime.attachChatView(chat);
    plugin.runtime.attachThreadsView(threads);
    verifyBatchActivation = true;

    await publishCodexPath(plugin, "codex-next");

    expect(chat.activateRuntime).toHaveBeenCalledTimes(2);
    expect(threads.activateRuntime).toHaveBeenCalledTimes(2);
  });

  it("finishes runtime replacement when one old view fails to detach", async () => {
    const broken = {
      attachRuntime: vi.fn(),
      activateRuntime: vi.fn(),
      detachRuntime: vi.fn(() => {
        throw new Error("detach failed");
      }),
    };
    const healthy = {
      attachRuntime: vi.fn(),
      activateRuntime: vi.fn(),
      detachRuntime: vi.fn(),
    };
    const plugin = await pluginWithLeaves([]);
    plugin.runtime.attachChatView(broken);
    plugin.runtime.attachChatView(healthy);
    healthy.attachRuntime.mockClear();

    await publishCodexPath(plugin, "codex-next");

    expect(broken.detachRuntime).toHaveBeenCalledOnce();
    expect(healthy.detachRuntime).toHaveBeenCalledOnce();
    expect(healthy.attachRuntime).toHaveBeenCalledOnce();
    expect(plugin.runtime.chatHost().appServerContext.codexPath).toBe("codex-next");
  });

  it("keeps activating healthy views when one replacement attachment fails", async () => {
    let failNextAttach = false;
    const broken = {
      attachRuntime: vi.fn(() => {
        if (failNextAttach) throw new Error("attach failed");
      }),
      activateRuntime: vi.fn(),
      detachRuntime: vi.fn(),
    };
    const healthy = {
      attachRuntime: vi.fn(),
      activateRuntime: vi.fn(),
      detachRuntime: vi.fn(),
    };
    const plugin = await pluginWithLeaves([]);
    plugin.runtime.attachChatView(broken);
    plugin.runtime.attachChatView(healthy);
    failNextAttach = true;
    healthy.activateRuntime.mockClear();

    await publishCodexPath(plugin, "codex-next");

    expect(broken.detachRuntime).toHaveBeenCalledTimes(2);
    expect(broken.activateRuntime).toHaveBeenCalledOnce();
    expect(healthy.activateRuntime).toHaveBeenCalledOnce();
    expect(plugin.runtime.chatHost().appServerContext.codexPath).toBe("codex-next");
  });

  it("cancels selection rewrites before publishing a new app-server context", async () => {
    const plugin = await pluginWithLeaves([]);
    const closeAll = vi.fn();
    plugin.runtime.setSelectionRewriteController({ closeAll });

    await publishCodexPath(plugin, "codex-next");

    expect(closeAll).toHaveBeenCalledOnce();
  });
});

describe("SwappableSettingsDynamicData", () => {
  it("moves existing observers to the replacement runtime", () => {
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    const first = {
      observeModelsResult: vi.fn(() => firstUnsubscribe),
      observeArchivedThreadsResult: vi.fn(() => vi.fn()),
    };
    const second = {
      observeModelsResult: vi.fn(() => secondUnsubscribe),
      observeArchivedThreadsResult: vi.fn(() => vi.fn()),
    };
    const dynamicData = new SwappableSettingsDynamicData();
    const listener = vi.fn();
    dynamicData.replace(first as never);
    const unsubscribe = dynamicData.observeModelsResult(listener, { emitCurrent: false });

    dynamicData.replace(second as never);

    expect(firstUnsubscribe).toHaveBeenCalledOnce();
    expect(second.observeModelsResult).toHaveBeenCalledWith(listener, { emitCurrent: false });
    unsubscribe();
    expect(secondUnsubscribe).toHaveBeenCalledOnce();
  });
});
