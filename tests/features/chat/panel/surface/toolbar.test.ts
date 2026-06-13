// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../../src/features/chat/state/reducer";
import { createToolbarArchiveConfirmState, createToolbarPanelActions } from "../../../../../src/features/chat/panel/toolbar-actions";
import type { ChatThreadActions } from "../../../../../src/features/chat/threads/action-context";

describe("createToolbarPanelActions", () => {
  it("tracks archive confirmation and delegates archive actions", async () => {
    const stateStore = createChatStateStore(createChatState());
    const archiveThread = vi.fn().mockResolvedValue(undefined);
    const scheduleRender = vi.fn();
    const actions = createToolbarPanelActions({
      stateStore,
      threadActions: { archiveThread } as unknown as ChatThreadActions,
      archiveConfirm: createToolbarArchiveConfirmState(),
      scheduleRender,
    });

    actions.startArchive("thread");
    expect(actions.archiveConfirmId()).toBe("thread");
    expect(scheduleRender).not.toHaveBeenCalled();

    await actions.archiveThread("thread", true);

    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    expect(actions.archiveConfirmId()).toBeNull();
    expect(scheduleRender).toHaveBeenCalledWith();
  });

  it("closes mutually exclusive toolbar panels on outside pointers", () => {
    const stateStore = createChatStateStore(createChatState());
    const scheduleRender = vi.fn();
    const actions = createToolbarPanelActions({
      stateStore,
      threadActions: { archiveThread: vi.fn() } as unknown as ChatThreadActions,
      archiveConfirm: createToolbarArchiveConfirmState(),
      scheduleRender,
    });
    actions.toggleHistory();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");

    actions.closeOnOutsidePointer({
      target: document.createElement("button"),
      viewWindow: window,
      contains: () => false,
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(scheduleRender).toHaveBeenCalledWith();
  });
});
