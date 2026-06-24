// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import type { ThreadManagementActions } from "../../../../src/features/chat/application/threads/thread-management-actions";
import { createChatPanelToolbarActions, createToolbarPanelActions } from "../../../../src/features/chat/panel/toolbar-actions";

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

describe("createChatPanelToolbarActions", () => {
  it("delegates compacting the active thread", () => {
    const deps = toolbarActionDeps();
    const actions = createChatPanelToolbarActions({ startNewThread: vi.fn() }, deps);

    actions.compactConversation();

    expect(vi.mocked(deps.threadActions.compactActiveThread)).toHaveBeenCalledOnce();
  });

  it("starts the goal editor from the active goal", () => {
    const deps = toolbarActionDeps();
    const actions = createChatPanelToolbarActions({ startNewThread: vi.fn() }, deps);

    actions.setGoal();

    expect(vi.mocked(deps.goals.startEditingCurrent)).toHaveBeenCalledOnce();
  });
});

function toolbarActionDeps(): Parameters<typeof createChatPanelToolbarActions>[1] {
  return {
    connectionController: { refreshStatusPanel: vi.fn() } as unknown as Parameters<
      typeof createChatPanelToolbarActions
    >[1]["connectionController"],
    reconnectPanel: vi.fn(),
    threadActions: {
      archiveThread: vi.fn().mockResolvedValue(undefined),
      compactActiveThread: vi.fn().mockResolvedValue(undefined),
      compactThread: vi.fn().mockResolvedValue(undefined),
    } as unknown as ThreadManagementActions,
    goals: {
      startEditingCurrent: vi.fn(),
    } as unknown as Parameters<typeof createChatPanelToolbarActions>[1]["goals"],
    toolbarPanels: {
      toggleChatActions: vi.fn(),
      toggleHistory: vi.fn(),
      toggleStatus: vi.fn(),
      startArchive: vi.fn(),
      archiveThread: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof createChatPanelToolbarActions>[1]["toolbarPanels"],
    rename: {
      start: vi.fn(),
      updateDraft: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      autoNameDraft: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof createChatPanelToolbarActions>[1]["rename"],
    selection: { selectThreadFromToolbar: vi.fn().mockResolvedValue(undefined) } as unknown as Parameters<
      typeof createChatPanelToolbarActions
    >[1]["selection"],
  };
}
