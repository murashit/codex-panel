// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createMetadataResourceDiagnostics } from "../../../../../src/domain/runtime/diagnostics";
import { createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ThreadCommands } from "../../../../../src/features/chat/application/threads/thread-commands";
import { createToolbarPanelActions, createToolbarUiActions } from "../../../../../src/features/chat/host/toolbar/actions";

describe("createToolbarPanelActions", () => {
  it.each([
    { method: "toggleChatActions", panel: "chat-actions" },
    { method: "toggleStatus", panel: "status-panel" },
  ] as const)("closes $panel when the same toolbar action is repeated", ({ method, panel }) => {
    const { stateStore, actions } = toolbarPanelActionsFixture();
    actions[method]();
    expect(stateStore.getState().ui.toolbarPanel).toBe(panel);
    actions[method]();
    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
  });

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
    const { stateStore, actions } = toolbarPanelActionsFixture();
    actions.toggleHistory();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");

    actions.closeOnOutsidePointer({
      hit: { insideToolbarPanel: false, insideArchiveConfirm: false },
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
  });

  it("keeps the panel open during rename while clearing archive confirmation on an outside pointer", () => {
    const { stateStore, actions } = toolbarPanelActionsFixture();
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
    const { stateStore, actions } = toolbarPanelActionsFixture();
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

  it("keeps header archive confirmation on its buttons and dismisses it outside even without a panel", () => {
    const { stateStore, actions } = toolbarPanelActionsFixture();
    actions.startArchive("thread");
    actions.closeOnOutsidePointer({ hit: { insideToolbarPanel: false, insideArchiveConfirm: true }, renameEditing: false });
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBe("thread");
    actions.closeOnOutsidePointer({ hit: { insideToolbarPanel: false, insideArchiveConfirm: false }, renameEditing: false });
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBeNull();
    actions.toggleHistory();
    actions.startArchive("thread");
    actions.closeOnOutsidePointer({ hit: { insideToolbarPanel: false, insideArchiveConfirm: true }, renameEditing: false });
    expect(stateStore.getState().ui.archiveConfirmThreadId).toBe("thread");
  });

  it("copies debug details from the latest state at invocation time", () => {
    const stateStore = createChatStateStore();
    const actions = createToolbarUiActions({
      runPanelAction: (action) => void action(),
      connectionCoordinator: {} as never,
      reconnectCommand: vi.fn(),
      threadCommands: {} as never,
      goals: {} as never,
      toolbarPanel: {} as never,
      rename: {} as never,
      navigation: {} as never,
      loadMoreThreads: async () => undefined,
      openSideChat: vi.fn(),
      debugDetails: {
        stateStore,
        connected: () => true,
        vaultPath: () => "/vault",
        configuredCommand: () => "codex",
        runtimeConfig: () => null,
        rateLimit: () => null,
        availableModels: () => [],
        metadataDiagnostics: () => createMetadataResourceDiagnostics(),
        toolInventory: () => ({
          plugins: null,
          pluginsError: null,
          mcpServers: null,
          mcpError: null,
          mcpDiagnostics: [
            { name: "notes", environmentId: "work", connectionStatus: "failed", message: "offline", authenticationIssue: null },
          ],
        }),
      },
    });
    stateStore.dispatch({
      type: "runtime/pending-intent-patched",
      patch: { model: { kind: "set", value: "gpt-live" } },
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      actions.status.copyDebugDetails();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }

    const debugContent = writeText.mock.calls.at(-1)?.[0];
    if (typeof debugContent !== "string") throw new Error("Expected copied debug details.");
    expect(JSON.parse(debugContent)).toMatchObject({
      vaultPath: "/vault",
      configuredCommand: "codex",
      connection: {
        connected: true,
        serverDiagnostics: {
          mcpServers: [
            { name: "notes", environmentId: "work", connectionStatus: "failed", authStatus: null, toolCount: null, message: "offline" },
          ],
        },
      },
      runtime: { pending: { model: { kind: "set", value: "gpt-live" } } },
    });
  });
});

function toolbarPanelActionsFixture() {
  const stateStore = createChatStateStore(createChatState());
  const actions = createToolbarPanelActions({
    stateStore,
    threadCommands: { archiveThread: vi.fn() } as unknown as ThreadCommands,
  });
  return { stateStore, actions };
}
