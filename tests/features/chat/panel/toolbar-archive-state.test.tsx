// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import type { ThreadManagementActions } from "../../../../src/features/chat/application/threads/thread-management-actions";
import { type ChatPanelShellParts, renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/panel/shell.dom";
import type { ChatPanelGoalSurface } from "../../../../src/features/chat/panel/surface/goal-projection";
import type { ChatPanelToolbarSurface } from "../../../../src/features/chat/panel/surface/toolbar-projection";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../../../../src/features/chat/panel/toolbar-actions";
import type { ThreadStreamContext } from "../../../../src/features/chat/ui/thread-stream/context";
import type { ThreadStreamScrollPortBinding } from "../../../../src/features/chat/ui/thread-stream/flow-scroll.measure";
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
    connection: {
      connected: () => false,
    },
    clock: {
      nowMs: () => 0,
    },
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled: () => true,
    },
  };
}

function shellParts(store: ReturnType<typeof createChatStateStore>, toolbarPanelActions: ToolbarPanelActions): ChatPanelShellParts {
  const surface = surfaceFixture(store, toolbarPanelActions);
  return {
    toolbar: {
      surface: surface.toolbar,
      actions: {
        primary: {
          toggleHistory: vi.fn(),
          toggleChatActions: vi.fn(),
          toggleStatusPanel: vi.fn(),
        },
        chat: {
          startNewThread: vi.fn(),
          compactContext: vi.fn(),
          setGoal: vi.fn(),
        },
        status: {
          connect: vi.fn(),
          refreshStatus: vi.fn(),
          copyDebugDetails: vi.fn(),
        },
        threads: {
          resume: vi.fn(),
          archive: {
            start: (threadId) => {
              toolbarPanelActions.startArchive(threadId);
            },
            confirm: vi.fn(),
          },
          rename: {
            start: vi.fn(),
            updateDraft: vi.fn(),
            save: vi.fn(),
            cancel: vi.fn(),
            autoName: vi.fn(),
          },
        },
      },
    },
    goal: surface.goal,
    threadStream: {
      renderState: () => ({
        blocks: [],
        context: testThreadStreamContext,
        scrollPortBinding: noOpThreadStreamScrollPortBinding,
      }),
    },
    composer: {
      presenter: {
        renderState: () => ({
          viewId: "view",
          draft: "",
          busy: false,
          canInterrupt: false,
          submissionDisabled: false,
          webSubmissionCancellable: false,
          normalPlaceholder: "Ask Codex...",
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
} {
  return {
    toolbar: toolbarSurface(store, toolbarActions),
    goal: {
      sendShortcut: () => "enter",
      actions: {
        saveObjective: async () => true,
        setStatus: async () => undefined,
        clear: async () => undefined,
        startEditing: () => undefined,
        updateObjectiveDraft: () => undefined,
        setObjectiveExpanded: () => undefined,
        closeEditor: () => undefined,
      },
    },
  };
}

const noOpThreadStreamScrollPortBinding: ThreadStreamScrollPortBinding = {
  mountScrollPort: () => () => undefined,
};

const testThreadStreamContext: ThreadStreamContext = {
  activeThreadId: "thread",
  workspaceRoot: "/vault",
  loadOlderTurns: () => undefined,
  disclosures: {
    details: new Set(),
    activityGroups: new Set(),
    textDetails: new Set(),
    userDialogueExpanded: new Set(),
    approvalDetails: new Set(),
  },
  forkMenuItemId: null,
  renderObsidianMarkdown: () => undefined,
  renderStreamMarkdown: () => undefined,
};

function threadFixture(id: string, name: string): Thread {
  return {
    id,
    name,
    preview: "",
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: 1,
    updatedAt: 1,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
