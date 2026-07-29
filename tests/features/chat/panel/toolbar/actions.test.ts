// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createServerDiagnostics } from "../../../../../src/domain/server/diagnostics";

import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ThreadCommands } from "../../../../../src/features/chat/application/threads/thread-commands";
import { createToolbarPanelActions, createToolbarUiActions } from "../../../../../src/features/chat/panel/toolbar/actions";

const copyTextWithNotice = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../../../../src/shared/obsidian/clipboard.obsidian", () => ({ copyTextWithNotice }));

describe("createToolbarPanelActions", () => {
  it("tracks archive confirmation and delegates archive actions", async () => {
    const stateStore = createChatStateStore(createChatState());
    const archiveThread = vi.fn().mockResolvedValue(undefined);
    const actions = createToolbarPanelActions({
      stateStore,
      threadCommands: { archiveThread } as unknown as ThreadCommands,
    });

    actions.startArchive("thread");
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBe("thread");

    await actions.archiveThread("thread", true);

    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBeNull();
  });

  it("closes mutually exclusive toolbar panels on outside pointers", () => {
    const stateStore = createChatStateStore(createChatState());
    const actions = createToolbarPanelActions({
      stateStore,
      threadCommands: { archiveThread: vi.fn() } as unknown as ThreadCommands,
    });
    actions.toggleHistory();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");

    actions.closeOnOutsidePointer({
      hit: { insideToolbarPanel: false, insideArchiveConfirm: false },
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
  });

  it("keeps the panel open during rename while clearing archive confirmation on an outside pointer", () => {
    const stateStore = createChatStateStore(createChatState());
    const actions = createToolbarPanelActions({
      stateStore,
      threadCommands: { archiveThread: vi.fn() } as unknown as ThreadCommands,
    });
    actions.toggleHistory();
    actions.startArchive("thread");

    actions.closeOnOutsidePointer({
      hit: { insideToolbarPanel: false, insideArchiveConfirm: false },
      renameEditing: true,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBeNull();
  });

  it("keeps archive confirmation only for pointers inside its confirmation row", () => {
    const stateStore = createChatStateStore(createChatState());
    const actions = createToolbarPanelActions({
      stateStore,
      threadCommands: { archiveThread: vi.fn() } as unknown as ThreadCommands,
    });
    actions.toggleHistory();
    actions.startArchive("thread");

    actions.closeOnOutsidePointer({
      hit: { insideToolbarPanel: true, insideArchiveConfirm: true },
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBe("thread");

    actions.closeOnOutsidePointer({
      hit: { insideToolbarPanel: true, insideArchiveConfirm: false },
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBeNull();
  });

  it("delegates chat commands to their policy-owning handlers", () => {
    const openSideChat = vi.fn();
    const compactActiveThread = vi.fn().mockResolvedValue(undefined);
    const startEditingCurrent = vi.fn();
    const actions = createToolbarUiActions({
      connectionCoordinator: {} as never,
      reconnectCommand: vi.fn(),
      threadCommands: { compactActiveThread } as never,
      goals: { startEditingCurrent } as never,
      toolbarPanel: {} as never,
      rename: {} as never,
      navigation: {} as never,
      loadMoreThreads: async () => [],
      openSideChat,
      debugDetails: debugDetailsFixture(),
    });

    actions.chat.startSideChat?.();
    actions.chat.compactContext();
    actions.chat.setGoal();
    expect(openSideChat).toHaveBeenCalledOnce();
    expect(compactActiveThread).toHaveBeenCalledOnce();
    expect(startEditingCurrent).toHaveBeenCalledOnce();
  });

  it("delegates pinned state updates from the thread list", () => {
    const setThreadPinned = vi.fn().mockResolvedValue(undefined);
    const actions = createToolbarUiActions({
      connectionCoordinator: {} as never,
      reconnectCommand: vi.fn(),
      threadCommands: { setThreadPinned } as never,
      goals: {} as never,
      toolbarPanel: {} as never,
      rename: {} as never,
      navigation: {} as never,
      loadMoreThreads: async () => [],
      openSideChat: vi.fn(),
      debugDetails: debugDetailsFixture(),
    });

    actions.threads.setPinned("thread", true);

    expect(setThreadPinned).toHaveBeenCalledWith("thread", true);
  });

  it("copies debug details from the latest state at invocation time", () => {
    const stateStore = createChatStateStore();
    const actions = createToolbarUiActions({
      connectionCoordinator: {} as never,
      reconnectCommand: vi.fn(),
      threadCommands: {} as never,
      goals: {} as never,
      toolbarPanel: {} as never,
      rename: {} as never,
      navigation: {} as never,
      loadMoreThreads: async () => [],
      openSideChat: vi.fn(),
      debugDetails: {
        stateStore,
        connected: () => true,
        vaultPath: () => "/vault",
        configuredCommand: () => "codex",
        runtimeConfig: () => null,
        rateLimit: () => null,
        availableModels: () => [],
        metadataDiagnostics: () => createServerDiagnostics(),
      },
    });
    stateStore.dispatch({ type: "runtime/model-requested", model: "gpt-live" });

    actions.status.copyDebugDetails();

    const debugContent = copyTextWithNotice.mock.calls.at(-1)?.[0];
    if (typeof debugContent !== "string") throw new Error("Expected copied debug details.");
    expect(JSON.parse(debugContent)).toMatchObject({
      vaultPath: "/vault",
      configuredCommand: "codex",
      connection: { connected: true },
      runtime: { pending: { model: { kind: "set", value: "gpt-live" } } },
    });
  });
});

function debugDetailsFixture() {
  return {
    stateStore: createChatStateStore(),
    connected: () => false,
    vaultPath: () => "/vault",
    configuredCommand: () => "codex",
    runtimeConfig: () => null,
    rateLimit: () => null,
    availableModels: () => [],
    metadataDiagnostics: () => createServerDiagnostics(),
  };
}
