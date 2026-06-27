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
});

describe("createToolbarUiActions", () => {
  it("maps primary toolbar controls to panel actions", () => {
    const deps = toolbarActionDeps();
    const actions = createToolbarUiActions(deps);

    actions.primary.toggleHistory();
    actions.primary.toggleChatActions();
    actions.primary.toggleStatusPanel();

    expect(vi.mocked(deps.toolbarPanel.toggleHistory)).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.toolbarPanel.toggleChatActions)).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.toolbarPanel.toggleStatus)).toHaveBeenCalledOnce();
  });

  it("starts a new thread through thread navigation", () => {
    const deps = toolbarActionDeps();
    const actions = createToolbarUiActions(deps);

    actions.chat.startNewThread();

    expect(vi.mocked(deps.navigation.startNewThread)).toHaveBeenCalledOnce();
  });

  it("delegates compacting the active thread", () => {
    const deps = toolbarActionDeps();
    const actions = createToolbarUiActions(deps);

    actions.chat.compactConversation();

    expect(vi.mocked(deps.threadActions.compactActiveThread)).toHaveBeenCalledOnce();
  });

  it("starts the goal editor from the active goal", () => {
    const deps = toolbarActionDeps();
    const actions = createToolbarUiActions(deps);

    actions.chat.setGoal();

    expect(vi.mocked(deps.goals.startEditingCurrent)).toHaveBeenCalledOnce();
  });

  it("maps thread list actions to navigation, archive, and rename actions", () => {
    const deps = toolbarActionDeps();
    const actions = createToolbarUiActions(deps);

    actions.threads.resume("thread");
    actions.threads.archive.start("thread");
    actions.threads.archive.confirm("thread", true);
    actions.threads.rename.start("thread");
    actions.threads.rename.updateDraft("thread", "Draft");
    actions.threads.rename.save("thread", "Saved");
    actions.threads.rename.cancel("thread");
    actions.threads.rename.autoName("thread");

    expect(vi.mocked(deps.navigation.selectThreadFromToolbar)).toHaveBeenCalledWith("thread");
    expect(vi.mocked(deps.toolbarPanel.startArchive)).toHaveBeenCalledWith("thread");
    expect(vi.mocked(deps.toolbarPanel.archiveThread)).toHaveBeenCalledWith("thread", true);
    expect(vi.mocked(deps.rename.start)).toHaveBeenCalledWith("thread");
    expect(vi.mocked(deps.rename.updateDraft)).toHaveBeenCalledWith("thread", "Draft");
    expect(vi.mocked(deps.rename.save)).toHaveBeenCalledWith("thread", "Saved");
    expect(vi.mocked(deps.rename.cancel)).toHaveBeenCalledWith("thread");
    expect(vi.mocked(deps.rename.autoNameDraft)).toHaveBeenCalledWith("thread");
  });
});

function toolbarActionDeps(): Parameters<typeof createToolbarUiActions>[0] {
  return {
    connectionController: { refreshStatusPanel: vi.fn() } as unknown as Parameters<
      typeof createToolbarUiActions
    >[0]["connectionController"],
    reconnectPanel: vi.fn(),
    threadActions: {
      archiveThread: vi.fn().mockResolvedValue(undefined),
      compactActiveThread: vi.fn().mockResolvedValue(undefined),
      compactThread: vi.fn().mockResolvedValue(undefined),
    } as unknown as ThreadManagementActions,
    goals: {
      startEditingCurrent: vi.fn(),
    } as unknown as Parameters<typeof createToolbarUiActions>[0]["goals"],
    toolbarPanel: {
      toggleChatActions: vi.fn(),
      toggleHistory: vi.fn(),
      toggleStatus: vi.fn(),
      startArchive: vi.fn(),
      archiveThread: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof createToolbarUiActions>[0]["toolbarPanel"],
    rename: {
      start: vi.fn(),
      updateDraft: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      autoNameDraft: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof createToolbarUiActions>[0]["rename"],
    navigation: {
      startNewThread: vi.fn().mockResolvedValue(undefined),
      selectThreadFromToolbar: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof createToolbarUiActions>[0]["navigation"],
  };
}
