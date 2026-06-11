// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../src/features/chat/state/reducer";
import { createToolbarArchiveConfirmState } from "../../../../src/features/chat/panel/toolbar-archive-confirm-state";
import { ToolbarPanelController } from "../../../../src/features/chat/panel/toolbar-controller";
import type { ChatThreadActions } from "../../../../src/features/chat/threads/thread-actions";

describe("ToolbarPanelController", () => {
  it("tracks archive confirmation and delegates archive actions", async () => {
    const stateStore = createChatStateStore(createChatState());
    const archiveThread = vi.fn().mockResolvedValue(undefined);
    const scheduleRender = vi.fn();
    const controller = new ToolbarPanelController({
      stateStore,
      threadActions: { archiveThread } as unknown as ChatThreadActions,
      archiveConfirm: createToolbarArchiveConfirmState(),
      scheduleRender,
    });

    controller.startArchive("thread");
    expect(controller.archiveConfirmId()).toBe("thread");
    expect(scheduleRender).not.toHaveBeenCalled();

    await controller.archiveThread("thread", true);

    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    expect(controller.archiveConfirmId()).toBeNull();
    expect(scheduleRender).toHaveBeenCalledWith();
  });

  it("closes mutually exclusive toolbar panels on outside pointers", () => {
    const stateStore = createChatStateStore(createChatState());
    const scheduleRender = vi.fn();
    const controller = new ToolbarPanelController({
      stateStore,
      threadActions: { archiveThread: vi.fn() } as unknown as ChatThreadActions,
      archiveConfirm: createToolbarArchiveConfirmState(),
      scheduleRender,
    });
    controller.toggleHistory();
    expect(stateStore.getState().ui.toolbarPanel).toBe("history");

    controller.closeOnOutsidePointer({
      target: document.createElement("button"),
      viewWindow: window,
      contains: () => false,
      renameEditing: false,
    });

    expect(stateStore.getState().ui.toolbarPanel).toBeNull();
    expect(scheduleRender).toHaveBeenCalledWith();
  });
});
