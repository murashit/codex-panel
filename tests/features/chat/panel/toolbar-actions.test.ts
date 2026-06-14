// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../src/features/chat/application/state/reducer";
import { createToolbarPanelActions } from "../../../../src/features/chat/panel/toolbar-actions";
import type { ThreadManagementActions } from "../../../../src/features/chat/application/threads/thread-management-actions";

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
      target: document.createElement("button"),
      viewWindow: window,
      contains: () => false,
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
  });
});
