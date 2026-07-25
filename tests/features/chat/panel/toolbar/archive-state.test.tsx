// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ThreadCommands } from "../../../../../src/features/chat/application/threads/thread-commands";
import type { ChatPanelGoalDependencies } from "../../../../../src/features/chat/panel/goal/view-projection";
import {
  type ChatPanelShellParts,
  renderChatPanelShell,
  unmountChatPanelShell,
} from "../../../../../src/features/chat/panel/shell/render.dom";
import type { ChatThreadStreamDependencies } from "../../../../../src/features/chat/panel/thread-stream/view-projection";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../../../../../src/features/chat/panel/toolbar/actions";
import type { ChatPanelToolbarDependencies } from "../../../../../src/features/chat/panel/toolbar/view-projection";
import type { ThreadStreamScrollPortBinding } from "../../../../../src/features/chat/ui/thread-stream/flow-scroll.measure";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("chat toolbar archive confirmation state", () => {
  it("updates a mounted toolbar archive confirmation through reducer-backed shell signals", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const toolbarActions = createToolbarPanelActions({
      stateStore: store,
      threadCommands: { archiveThread: vi.fn() } as unknown as ThreadCommands,
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

  it("reprojects the archive default when settings refresh the mounted shell", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const toolbarActions = createToolbarPanelActions({
      stateStore: store,
      threadCommands: { archiveThread: vi.fn() } as unknown as ThreadCommands,
    });
    let archiveExportEnabled = true;
    const parts = shellParts(store, toolbarActions, () => archiveExportEnabled);
    store.dispatch({ type: "thread-list/applied", threads: [threadFixture("thread-1", "Thread one")] });
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    toolbarActions.startArchive("thread-1");
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settle();
    });
    expect(container.querySelector(".codex-panel__archive-default")?.getAttribute("aria-label")).toBe("Save and archive thread");

    archiveExportEnabled = false;
    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settle();
    });
    expect(container.querySelector(".codex-panel__archive-default")?.getAttribute("aria-label")).toBe("Archive thread without saving");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });
});

function toolbarSurface(
  _store: ReturnType<typeof createChatStateStore>,
  _toolbarActions: ToolbarPanelActions,
  archiveExportEnabled: () => boolean,
): ChatPanelToolbarDependencies {
  return {
    connection: {
      connected: () => false,
    },
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled,
    },
  };
}

function shellParts(
  store: ReturnType<typeof createChatStateStore>,
  toolbarPanelActions: ToolbarPanelActions,
  archiveExportEnabled: () => boolean = () => true,
): ChatPanelShellParts {
  const surface = surfaceFixture(store, toolbarPanelActions, archiveExportEnabled);
  return {
    toolbar: {
      dependencies: surface.toolbar,
      actions: {
        primary: {
          toggleHistory: vi.fn(),
          toggleChatActions: vi.fn(),
          toggleStatusPanel: vi.fn(),
        },
        chat: {
          startNewThread: vi.fn(),
          startSideChat: vi.fn(),
          compactContext: vi.fn(),
          setGoal: vi.fn(),
        },
        status: {
          connect: vi.fn(),
          refreshStatus: vi.fn(),
          copyDebugDetails: vi.fn(),
        },
        threads: {
          loadMore: vi.fn(),
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
            cancelAutoName: vi.fn(),
            autoName: vi.fn(),
          },
        },
      },
    },
    goal: surface.goal,
    threadStream: {
      context: testThreadStreamContext,
      scrollPortBinding: noOpThreadStreamScrollPortBinding,
    },
    composer: {
      presenter: {
        renderState: () => ({
          viewId: "view",
          draft: "",
          busy: false,
          canInterrupt: false,
          submissionDisabled: false,
          directInputDisabled: false,
          runtimeControlsDisabled: false,
          sendDisabled: false,
          webSubmissionCancellable: false,
          normalPlaceholder: "Ask Codex...",
          suggestions: [],
          selectedSuggestionIndex: 0,
          pendingSelection: null,
          onPendingSelectionApplied: vi.fn(),
          callbacks: {
            onInput: vi.fn(),
            onUpdateSuggestions: vi.fn(),
            onKeydown: vi.fn(),
            onPaste: vi.fn(),
            onDrop: vi.fn(),
            onDragOver: vi.fn(),
            onSendOrInterrupt: vi.fn(),
            onTogglePlan: vi.fn(),
            onToggleAutoReview: vi.fn(),
            onToggleFast: vi.fn(),
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
  archiveExportEnabled: () => boolean,
): {
  toolbar: ChatPanelToolbarDependencies;
  goal: ChatPanelGoalDependencies;
} {
  return {
    toolbar: toolbarSurface(store, toolbarActions, archiveExportEnabled),
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

const testThreadStreamContext: ChatThreadStreamDependencies = {
  panelId: "test-panel",
  vaultPath: "/vault",
  setDisclosureOpen: vi.fn(),
  setForkMenuItem: vi.fn(),
  loadOlderTurns: () => undefined,
  renderObsidianMarkdown: () => undefined,
  renderStreamMarkdown: () => undefined,
  copyDialogueText: () => undefined,
  actions: {
    rollbackThread: vi.fn(),
    forkThreadFromTurn: vi.fn(),
    implementPlan: vi.fn(),
    openThreadInAvailableView: vi.fn(),
    openThreadInNewView: vi.fn(),
    openTurnDiff: vi.fn(),
  },
  requests: {
    actions: {
      resolveApproval: vi.fn(),
      resolveUserInput: vi.fn(),
      cancelUserInput: vi.fn(),
      resolveMcpElicitation: vi.fn(),
      setApprovalDetailsExpanded: vi.fn(),
      setUserInputDraft: vi.fn(),
      setMcpElicitationDraft: vi.fn(),
    },
    consumeAutoFocus: () => false,
  },
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
