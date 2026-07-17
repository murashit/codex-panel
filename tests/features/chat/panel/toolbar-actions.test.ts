// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import type { ThreadManagementActions } from "../../../../src/features/chat/application/threads/thread-management-actions";
import { createToolbarPanelActions, createToolbarUiActions } from "../../../../src/features/chat/panel/toolbar-actions";

describe("createToolbarPanelActions", () => {
  it("tracks archive confirmation and delegates archive actions", async () => {
    const stateStore = createChatStateStore(createChatState());
    const archiveThread = vi.fn().mockResolvedValue(undefined);
    const actions = createToolbarPanelActions({
      stateStore,
      threadActions: { archiveThread } as unknown as ThreadManagementActions,
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
      threadActions: { archiveThread: vi.fn() } as unknown as ThreadManagementActions,
    });
    actions.toggleHistory();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");

    actions.closeOnOutsidePointer({
      hit: { insideToolbarPanel: false, insideArchiveConfirm: false },
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
  });

  it("keeps the Set goal action reachable while a restored thread needs hydration", () => {
    const stateStore = createChatStateStore(createChatState());
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    const startEditingCurrent = vi.fn();
    const actions = createToolbarUiActions({
      connectionActions: {} as never,
      reconnectPanel: vi.fn(),
      threadActions: {} as never,
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
});
