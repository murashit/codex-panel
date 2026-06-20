// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

import type { Thread } from "../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../../../../src/features/chat/panel/toolbar-actions";
import type { ChatPanelComposerSurface } from "../../../../src/features/chat/panel/surface/composer-projection";
import type { ChatPanelGoalSurface } from "../../../../src/features/chat/panel/surface/goal-projection";
import type { ChatPanelToolbarSurface } from "../../../../src/features/chat/panel/surface/toolbar-projection";
import type { ThreadManagementActions } from "../../../../src/features/chat/application/threads/thread-management-actions";
import { renderChatPanelShell, unmountChatPanelShell, type ChatPanelShellParts } from "../../../../src/features/chat/panel/shell";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("chat toolbar archive confirmation state", () => {
  it("updates a mounted toolbar archive confirmation through reducer-backed shell signals", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const toolbarActions = createToolbarPanelActions({
      stateStore: store,
      threadActions: { archiveThread: vi.fn() } as unknown as ThreadManagementActions,
    });
    store.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread-1", "Thread one")] });
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, {
        stateStore: store,
        showToolbar: true,
        parts: shellParts(store, toolbarActions),
      });
      await settle();
    });

    expect(container.querySelector(".codex-panel__archive-confirm")).toBeNull();

    await act(async () => {
      toolbarActions.startArchive("thread-1");
      await settle();
    });

    expect(container.querySelector(".codex-panel__archive-confirm")).not.toBeNull();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });
});

function toolbarSurface(_store: ReturnType<typeof createChatStateStore>, _toolbarActions: ToolbarPanelActions): ChatPanelToolbarSurface {
  return {
    state: {
      connected: () => false,
      nowMs: () => 0,
    },
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled: () => true,
    },
  };
}

function shellParts(store: ReturnType<typeof createChatStateStore>, toolbarActions: ToolbarPanelActions): ChatPanelShellParts {
  const surface = surfaceFixture(store, toolbarActions);
  return {
    toolbar: {
      surface: surface.toolbar,
      actions: {
        startNewThread: vi.fn(),
        toggleChatActions: vi.fn(),
        compactConversation: vi.fn(),
        setGoal: vi.fn(),
        toggleHistory: vi.fn(),
        toggleStatusPanel: vi.fn(),
        connect: vi.fn(),
        refreshStatus: vi.fn(),
        copyDebugDetails: vi.fn(),
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
    goal: surface.goal,
    messageStream: {
      renderState: () => ({
        blocks: [],
        consumeScrollIntent: () => "auto",
      }),
    },
    composer: {
      renderer: {
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
      actions: {
        submit: vi.fn(),
      },
    },
  };
}

function surfaceFixture(
  store: ReturnType<typeof createChatStateStore>,
  toolbarActions: ToolbarPanelActions,
): {
  toolbar: ChatPanelToolbarSurface;
  goal: ChatPanelGoalSurface;
  composer: ChatPanelComposerSurface;
} {
  return {
    toolbar: toolbarSurface(store, toolbarActions),
    goal: {
      settings: { sendShortcut: () => "enter" },
      actions: {
        goal: {
          saveObjective: async () => true,
          setStatus: async () => undefined,
          clear: async () => undefined,
          startEditing: () => undefined,
          updateObjectiveDraft: () => undefined,
          setObjectiveExpanded: () => undefined,
          closeEditor: () => undefined,
        },
      },
    },
    composer: {
      thread: { restoredPlaceholder: () => null },
      runtime: {
        requestModel: async () => undefined,
        requestReasoningEffort: async () => undefined,
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
