// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState } from "../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createChatPanelToolbarActions, createToolbarPanelActions } from "../../../../src/features/chat/panel/toolbar-actions";
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

describe("createChatPanelToolbarActions", () => {
  it("reports compact without an active thread through the inbound controller", () => {
    const stateStore = createChatStateStore(createChatState());
    const deps = toolbarActionDeps();
    const actions = createChatPanelToolbarActions({ stateStore, startNewThread: vi.fn() }, deps);

    actions.compactConversation();

    expect((deps.inboundController.addSystemMessage as unknown as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ["No active thread to compact."],
    ]);
    expect(vi.mocked(deps.threadActions.compactThread)).not.toHaveBeenCalled();
  });

  it("compacts the active thread", () => {
    const stateStore = createChatStateStore(createChatState());
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: { id: "thread", name: null, preview: "", archived: false, createdAt: 1, updatedAt: 1 },
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    const deps = toolbarActionDeps();
    const actions = createChatPanelToolbarActions({ stateStore, startNewThread: vi.fn() }, deps);

    actions.compactConversation();

    expect(vi.mocked(deps.threadActions.compactThread)).toHaveBeenCalledWith("thread");
  });

  it("starts the goal editor from the active goal", () => {
    const stateStore = createChatStateStore(createChatState());
    stateStore.dispatch({
      type: "active-thread/goal-set",
      goal: {
        threadId: "thread",
        objective: "Ship it",
        status: "active",
        tokenBudget: 5,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const actions = createChatPanelToolbarActions({ stateStore, startNewThread: vi.fn() }, toolbarActionDeps());

    actions.setGoal();

    expect(stateStore.getState().ui.goalEditor).toEqual({
      kind: "editing",
      threadId: "thread",
      objectiveDraft: "Ship it",
      tokenBudgetDraft: 5,
    });
  });
});

function toolbarActionDeps(): Parameters<typeof createChatPanelToolbarActions>[1] {
  return {
    connectionController: { refreshStatusPanel: vi.fn() } as unknown as Parameters<
      typeof createChatPanelToolbarActions
    >[1]["connectionController"],
    reconnectPanel: vi.fn(),
    inboundController: { addSystemMessage: vi.fn() } as unknown as Parameters<typeof createChatPanelToolbarActions>[1]["inboundController"],
    threadActions: {
      archiveThread: vi.fn().mockResolvedValue(undefined),
      compactThread: vi.fn().mockResolvedValue(undefined),
    } as unknown as ThreadManagementActions,
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
