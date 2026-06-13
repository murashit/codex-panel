// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { signal } from "@preact/signals";

import type { Thread } from "../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../src/features/chat/state/reducer";
import {
  createToolbarArchiveConfirmState,
  createToolbarPanelActions,
  type ToolbarPanelActions,
} from "../../../../src/features/chat/panel/toolbar-actions";
import type { ChatPanelSurfacePorts, ChatPanelToolbarPorts } from "../../../../src/features/chat/panel/surface/ports";
import type { ChatThreadActions } from "../../../../src/features/chat/threads/action-context";
import { renderChatPanelShell, unmountChatPanelShell, type ChatPanelShellSlots } from "../../../../src/features/chat/ui/shell";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("chat toolbar archive confirmation signal", () => {
  it("updates a mounted toolbar archive confirmation without a scheduled shell render", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const archiveConfirm = createToolbarArchiveConfirmState();
    const scheduleRender = vi.fn();
    const toolbarActions = createToolbarPanelActions({
      stateStore: store,
      threadActions: { archiveThread: vi.fn() } as unknown as ChatThreadActions,
      archiveConfirm,
      scheduleRender,
    });
    store.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread-1", "Thread one")] });
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, {
        stateStore: store,
        showToolbar: true,
        slots: shellSlots(store, toolbarActions),
      });
      await settle();
    });

    expect(container.querySelector(".codex-panel__archive-confirm")).toBeNull();

    await act(async () => {
      toolbarActions.startArchive("thread-1");
      await settle();
    });

    expect(scheduleRender).not.toHaveBeenCalled();
    expect(container.querySelector(".codex-panel__archive-confirm")).not.toBeNull();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });
});

function toolbarPorts(store: ReturnType<typeof createChatStateStore>, toolbarActions: ToolbarPanelActions): ChatPanelToolbarPorts {
  return {
    state: {
      connected: () => false,
    },
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled: () => true,
    },
    view: {
      toolbar: {
        archiveConfirm: toolbarActions.archiveConfirm,
        renameState: () => null,
        renameVersion: signal(0),
      },
    },
    actions: {
      toolbar: {
        startNewThread: vi.fn(),
        toggleChatActions: vi.fn(),
        compactConversation: vi.fn(),
        setGoal: vi.fn(),
        toggleHistory: vi.fn(),
        toggleStatusPanel: vi.fn(),
        connect: vi.fn(),
        refreshStatus: vi.fn(),
        resumeThread: vi.fn(),
        startArchiveThread: (threadId) => {
          toolbarActions.startArchive(threadId);
        },
        archiveThread: vi.fn(),
        startRenameThread: vi.fn(),
        updateRenameDraft: vi.fn(),
        saveRenameThread: vi.fn(),
        cancelRenameThread: vi.fn(),
        autoNameThread: vi.fn(),
      },
    },
  };
}

function shellSlots(store: ReturnType<typeof createChatStateStore>, toolbarActions: ToolbarPanelActions): ChatPanelShellSlots {
  const ports = surfacePorts(store, toolbarActions);
  return {
    toolbar: ports.toolbar,
    goal: ports.goal,
    messageStream: {
      renderState: () => ({
        blocks: [],
        consumeScrollIntent: () => "auto",
      }),
    },
    composer: {
      renderState: () => ({
        viewId: "view",
        draft: "",
        busy: false,
        canInterrupt: false,
        normalPlaceholder: "Ask Codex to work on this task...",
        suggestions: [],
        selectedSuggestionIndex: 0,
        callbacks: {
          onInput: vi.fn(),
          onUpdateSuggestions: vi.fn(),
          onKeydown: vi.fn(),
          onSendOrInterrupt: vi.fn(),
          onHeightChange: vi.fn(),
          onSuggestionHover: vi.fn(),
          onSuggestionInsert: vi.fn(),
        },
        meta: {
          fatal: null,
          context: {
            cells: [
              { text: "⣀", placeholder: true },
              { text: "⣀", placeholder: true },
              { text: "⣀", placeholder: true },
              { text: "⣀", placeholder: true },
            ],
            percent: "--%",
          },
          statusSummary: "Context unavailable, plan off, auto-review off, fast off, model default, reasoning effort default",
          model: "default",
          effort: null,
          planActive: false,
          autoReviewActive: false,
          fastActive: false,
          modelChoices: [],
          effortChoices: [],
        },
        onComposer: () => undefined,
      }),
    },
  };
}

function surfacePorts(store: ReturnType<typeof createChatStateStore>, toolbarActions: ToolbarPanelActions): ChatPanelSurfacePorts {
  return {
    toolbar: toolbarPorts(store, toolbarActions),
    goal: {
      settings: { sendShortcut: () => "enter" },
      actions: {
        goal: {
          saveObjective: async () => undefined,
          setStatus: async () => undefined,
          clear: async () => undefined,
          setEditingOpen: () => undefined,
        },
      },
    },
    composer: {
      thread: { restoredPlaceholder: () => null },
      runtime: {
        requestModel: async () => undefined,
        requestReasoningEffort: async () => undefined,
        resetReasoningEffortToConfig: async () => undefined,
      },
    },
  };
}

function threadFixture(id: string, name: string): Thread {
  return {
    id,
    name,
    preview: "",
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
