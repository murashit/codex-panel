// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import type { ThreadCommands } from "../../../../src/features/chat/application/threads/thread-commands";
import { createToolbarPanelActions, createToolbarUiActions } from "../../../../src/features/chat/panel/toolbar-actions";

describe("createToolbarPanelActions", () => {
  it("tracks archive confirmation and delegates archive actions", async () => {
    const stateStore = createChatStateStore(createChatState());
    const archiveThread = vi.fn().mockResolvedValue(undefined);
    const actions = createToolbarPanelActions({
      stateStore,
      threadCommands: { archiveThread } as unknown as ThreadCommands,
    });

    actions.startArchive("thread");
    expect(actions.archiveConfirmId()).toBe("thread");

    await actions.archiveThread("thread", true);

    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    expect(actions.archiveConfirmId()).toBeNull();
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
    expect(actions.archiveConfirmId()).toBeNull();
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
    expect(actions.archiveConfirmId()).toBe("thread");

    actions.closeOnOutsidePointer({
      hit: { insideToolbarPanel: true, insideArchiveConfirm: false },
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBe("history");
    expect(actions.archiveConfirmId()).toBeNull();
  });

  it("keeps the Set goal action reachable while a restored thread needs hydration", () => {
    const stateStore = createChatStateStore(createChatState());
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    const startEditingCurrent = vi.fn();
    const actions = createToolbarUiActions({
      connectionCoordinator: {} as never,
      reconnectCommand: vi.fn(),
      threadCommands: {} as never,
      goals: { startEditingCurrent } as never,
      toolbarPanel: {} as never,
      rename: {} as never,
      navigation: {} as never,
      canStartSideChat: () => false,
      canCompact: () => false,
      canMutateGoal: () => true,
    });

    actions.chat.setGoal();

    expect(startEditingCurrent).toHaveBeenCalledOnce();
  });

  it("gates side chat, compaction, and goal mutation at invocation time", () => {
    let enabled = false;
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
      openSideChat,
      canStartSideChat: () => enabled,
      canCompact: () => enabled,
      canMutateGoal: () => enabled,
    });

    actions.chat.startSideChat?.();
    actions.chat.compactContext();
    actions.chat.setGoal();
    expect(openSideChat).not.toHaveBeenCalled();
    expect(compactActiveThread).not.toHaveBeenCalled();
    expect(startEditingCurrent).not.toHaveBeenCalled();

    enabled = true;
    actions.chat.startSideChat?.();
    actions.chat.compactContext();
    actions.chat.setGoal();
    expect(openSideChat).toHaveBeenCalledOnce();
    expect(compactActiveThread).toHaveBeenCalledOnce();
    expect(startEditingCurrent).toHaveBeenCalledOnce();
  });
});
