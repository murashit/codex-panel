// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { messageStreamItems } from "../../../../src/features/chat/application/state/message-stream";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { type ChatPanelShellParts, renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/panel/shell";
import type { ChatPanelComposerSurface } from "../../../../src/features/chat/panel/surface/composer-projection";
import type { ChatPanelGoalSurface } from "../../../../src/features/chat/panel/surface/goal-projection";
import type { ChatPanelToolbarSurface } from "../../../../src/features/chat/panel/surface/toolbar-projection";
import { messageStreamViewBlocks } from "../../../../src/features/chat/presentation/message-stream/view-model";
import type { MessageStreamContext } from "../../../../src/features/chat/ui/message-stream/context";
import type { MessageStreamScrollControllerBinding } from "../../../../src/features/chat/ui/message-stream/flow-scroll";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatPanelShell", () => {
  it("composes toolbar, goal, message stream, and composer in one Preact root", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, shellProps(store));
      await settleShellEffects();
    });

    expect(container.classList.contains("codex-panel")).toBe(true);
    expect(container.querySelector(".codex-panel__toolbar .codex-panel__toolbar-primary")).not.toBeNull();
    expect(container.querySelector(".codex-panel__body > .codex-panel__region--message-stream")).toBe(
      container.querySelector(".codex-panel__body > .codex-panel__messages"),
    );
    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("");
    expect(container.querySelector(".codex-panel__message-block")?.textContent).toContain("Send a message");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("updates shell components from the state store", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, shellProps(store));
      await settleShellEffects();
    });

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "ready", clearSuggestions: true });
      store.dispatch({
        type: "message-stream/system-item-added",
        item: { id: "system-1", kind: "system", role: "system", text: "Model set." },
      });
      await settleShellEffects();
    });

    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("ready");
    expect(container.querySelector(".codex-panel__message-block")?.textContent).toContain("Model set.");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("keeps composer rendering off message stream updates until turn presence changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();
    const renderComposerState = vi.fn(parts.composer.renderer.renderState.bind(parts.composer.renderer));
    parts.composer.renderer.renderState = renderComposerState;

    await act(async () => {
      renderChatPanelShell(container, { ...shellProps(store), parts });
      await settleShellEffects();
    });
    renderComposerState.mockClear();

    await act(async () => {
      store.dispatch({
        type: "message-stream/system-item-added",
        item: { id: "system-1", kind: "system", role: "system", text: "Status only." },
      });
      await settleShellEffects();
    });
    expect(renderComposerState).not.toHaveBeenCalled();

    await act(async () => {
      store.dispatch({
        type: "message-stream/item-added",
        item: {
          id: "assistant-1",
          turnId: "turn-1",
          kind: "message",
          messageKind: "assistantResponse",
          messageState: "completed",
          role: "assistant",
          text: "Turn response.",
        },
      });
      await settleShellEffects();
    });
    expect(renderComposerState).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("keeps toolbar rendering off turn updates until busy state changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const toolbarConnected = vi.fn(() => false);

    await act(async () => {
      renderChatPanelShell(container, { ...shellProps(store), parts: shellParts({ toolbarConnected }) });
      await settleShellEffects();
    });
    toolbarConnected.mockClear();

    await act(async () => {
      store.dispatch({
        type: "turn/optimistic-started",
        item: { id: "local-user", kind: "message", messageKind: "user", role: "user", text: "hello" },
        pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] },
      });
      await settleShellEffects();
    });
    expect(toolbarConnected).toHaveBeenCalledTimes(1);
    toolbarConnected.mockClear();

    await act(async () => {
      store.dispatch({
        type: "turn/start-acknowledged",
        turnId: "turn-1",
        items: [{ id: "local-user", turnId: "turn-1", kind: "message", messageKind: "user", role: "user", text: "hello" }],
      });
      await settleShellEffects();
    });
    expect(toolbarConnected).not.toHaveBeenCalled();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("keeps goal rendering off active thread updates until goal state changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const goalSendShortcut = vi.fn(() => "enter" as const);

    await act(async () => {
      renderChatPanelShell(container, { ...shellProps(store), parts: shellParts({ goalSendShortcut }) });
      await settleShellEffects();
    });
    goalSendShortcut.mockClear();

    await act(async () => {
      store.dispatch({
        type: "active-thread/token-usage-set",
        tokenUsage: tokenUsageFixture(),
      });
      await settleShellEffects();
    });
    expect(goalSendShortcut).not.toHaveBeenCalled();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("keeps message stream rendering off active thread updates until stream thread fields change", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();
    const renderMessageStreamState = vi.fn(parts.messageStream.renderState.bind(parts.messageStream));
    parts.messageStream.renderState = renderMessageStreamState;

    await act(async () => {
      renderChatPanelShell(container, { ...shellProps(store), parts });
      await settleShellEffects();
    });
    renderMessageStreamState.mockClear();

    await act(async () => {
      store.dispatch({
        type: "active-thread/token-usage-set",
        tokenUsage: tokenUsageFixture(),
      });
      await settleShellEffects();
    });
    expect(renderMessageStreamState).not.toHaveBeenCalled();

    await act(async () => {
      store.dispatch({ type: "active-thread/cwd-set", cwd: "/workspace" });
      await settleShellEffects();
    });
    expect(renderMessageStreamState).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("removes and restores the toolbar from shell props without replacing the body regions", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: false, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__region--message-stream")).not.toBeNull();
    expect(container.querySelector(".codex-panel__region--composer")).not.toBeNull();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).not.toBeNull();
    expect(container.firstElementChild?.classList.contains("codex-panel__toolbar")).toBe(true);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("repairs a missing toolbar through an explicit shell render", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    container.querySelector<HTMLElement>(":scope > .codex-panel__toolbar")?.remove();

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "repair toolbar" });
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar .codex-panel__toolbar-primary")).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("repair toolbar");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("repairs unexpected root-level DOM through an explicit shell render", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    container.appendChild(document.createElement("section"));

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "repair root" });
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector(".codex-panel__toolbar .codex-panel__toolbar-primary")).not.toBeNull();
    expect(container.querySelector(".codex-panel__body .codex-panel__messages")).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("repair root");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("sets composer bottom clearance only for fixed visible Obsidian status bars", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const statusBar = document.createElement("div");
    statusBar.className = "status-bar";
    document.body.appendChild(statusBar);
    document.body.appendChild(container);
    Object.defineProperty(statusBar, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 26, width: 100, top: 0, right: 100, bottom: 26, left: 0, x: 0, y: 0, toJSON: () => ({}) }),
    });

    await act(async () => {
      statusBar.style.display = "flex";
      statusBar.style.position = "fixed";
      renderChatPanelShell(container, shellProps(store));
      await settleShellEffects();
    });
    expect(container.style.getPropertyValue("--codex-panel-status-bar-clearance")).toBe("26px");

    await act(async () => {
      statusBar.style.position = "static";
      renderChatPanelShell(container, shellProps(store));
      await settleShellEffects();
    });
    expect(container.style.getPropertyValue("--codex-panel-status-bar-clearance")).toBe("0px");

    await act(async () => {
      unmountChatPanelShell(container);
    });
    statusBar.remove();
  });
});

function shellProps(store: ReturnType<typeof createChatStateStore>) {
  return {
    stateStore: store,
    showToolbar: true,
    parts: shellParts(),
  };
}

function shellParts(
  options: { toolbarConnected?: () => boolean; goalSendShortcut?: () => "enter" | "mod-enter" } = {},
): ChatPanelShellParts {
  const surface = surfaceFixture(options);
  return {
    toolbar: {
      surface: surface.toolbar,
      actions: toolbarActionsFixture(),
    },
    goal: surface.goal,
    messageStream: {
      renderState: (state) => ({
        blocks: messageStreamViewBlocks({
          activeThreadId: state.activeThreadId,
          activeTurnId: null,
          historyCursor: state.messageStream.historyCursor,
          loadingHistory: state.messageStream.loadingHistory,
          items: messageStreamItems(state.messageStream),
        }),
        context: testMessageStreamContext,
        scrollController: noOpMessageStreamScrollController,
      }),
    },
    composer: {
      renderer: {
        renderState: (state) => ({
          viewId: "view",
          draft: state.composer.draft,
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

const testMessageStreamContext: MessageStreamContext = {
  activeThreadId: "thread",
  workspaceRoot: "/vault",
  loadOlderTurns: () => undefined,
  disclosures: {
    details: new Set(),
    activityGroups: new Set(),
    textDetails: new Set(),
    userMessageExpanded: new Set(),
    goalObjectiveExpanded: new Set(),
    approvalDetails: new Set(),
  },
  forkMenuItemId: null,
  renderObsidianMarkdown: () => undefined,
  renderStreamMarkdown: () => undefined,
};

function surfaceFixture(options: { toolbarConnected?: () => boolean; goalSendShortcut?: () => "enter" | "mod-enter" } = {}): {
  toolbar: ChatPanelToolbarSurface;
  goal: ChatPanelGoalSurface;
  composer: ChatPanelComposerSurface;
} {
  return {
    toolbar: {
      state: {
        connected: options.toolbarConnected ?? (() => false),
        nowMs: () => 0,
      },
      settings: {
        vaultPath: () => "/vault",
        configuredCommand: () => "codex",
        archiveExportEnabled: () => true,
      },
    },
    goal: {
      settings: { sendShortcut: options.goalSendShortcut ?? (() => "enter") },
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

const noOpMessageStreamScrollController: MessageStreamScrollControllerBinding = {
  mountScrollPort: () => () => undefined,
};

function toolbarActionsFixture(): ChatPanelShellParts["toolbar"]["actions"] {
  return {
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
    startArchiveThread: vi.fn(),
    archiveThread: vi.fn(),
    startRenameThread: vi.fn(),
    updateRenameDraft: vi.fn(),
    saveRenameThread: vi.fn(),
    cancelRenameThread: vi.fn(),
    autoNameThread: vi.fn(),
  };
}

function tokenUsageFixture() {
  return {
    total: { totalTokens: 10, inputTokens: 7, cachedInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 0 },
    last: { totalTokens: 10, inputTokens: 7, cachedInputTokens: 0, outputTokens: 3, reasoningOutputTokens: 0 },
    modelContextWindow: 100,
  };
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
