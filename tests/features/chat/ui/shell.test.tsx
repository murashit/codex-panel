// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

import { createChatStateStore } from "../../../../src/features/chat/state/reducer";
import { messageStreamDisplayItems } from "../../../../src/features/chat/state/message-stream";
import { renderChatPanelShell, unmountChatPanelShell, type ChatPanelShellParts } from "../../../../src/features/chat/ui/shell";
import type { ChatPanelComposerShellState, ChatPanelMessageStreamShellState } from "../../../../src/features/chat/ui/shell-state";
import type { ChatPanelSurface } from "../../../../src/features/chat/panel/surface/model";
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
    expect(container.querySelector(".codex-panel__message-block .test-message-count")?.textContent).toBe("0");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("updates signal-aware shell components from the state store without remounting the shell", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, shellProps(store));
      await settleShellEffects();
    });
    const body = container.querySelector<HTMLElement>('[data-codex-panel-shell-region="body"]');
    const toolbar = container.querySelector<HTMLElement>('[data-codex-panel-shell-region="toolbar"]');

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "ready", clearSuggestions: true });
      store.dispatch({
        type: "message-stream/system-item-added",
        item: { id: "system-1", kind: "system", role: "system", text: "Model set." },
      });
      await settleShellEffects();
    });

    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("ready");
    expect(container.querySelector(".codex-panel__message-block .test-message-count")?.textContent).toBe("1");
    expect(container.querySelector<HTMLElement>('[data-codex-panel-shell-region="body"]')).toBe(body);
    expect(container.querySelector<HTMLElement>('[data-codex-panel-shell-region="toolbar"]')).toBe(toolbar);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("does not invalidate unrelated shell parts for composer-only state changes", async () => {
    const store = createChatStateStore();
    store.dispatch({
      type: "thread-list/applied",
      threads: [{ id: "thread-1", name: "Thread", preview: "", archived: false, createdAt: 1, updatedAt: 1 }],
    });
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const testShell = trackedShellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts: testShell.parts });
      await settleShellEffects();
    });
    const messageStream = container.querySelector<HTMLElement>('[data-codex-panel-shell-region="message-stream"]');
    testShell.composerRenderState.mockClear();
    testShell.messageStreamRenderState.mockClear();

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "composer only", clearSuggestions: true });
      await settleShellEffects();
    });

    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("composer only");
    expect(container.querySelector<HTMLElement>('[data-codex-panel-shell-region="message-stream"]')).toBe(messageStream);
    expect(testShell.composerRenderState).toHaveBeenCalledOnce();
    expect(testShell.composerRenderState.mock.calls[0]?.[0].composer.draft).toBe("composer only");
    expect(testShell.messageStreamRenderState).not.toHaveBeenCalled();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("does not invalidate the toolbar for message-stream-only state changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const testShell = trackedShellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts: testShell.parts });
      await settleShellEffects();
    });
    const toolbar = container.querySelector<HTMLElement>('[data-codex-panel-shell-region="toolbar"]');
    testShell.toolbarConnected.mockClear();
    testShell.messageStreamRenderState.mockClear();

    await act(async () => {
      store.dispatch({
        type: "message-stream/system-item-added",
        item: { id: "system-1", kind: "system", role: "system", text: "Stream only." },
      });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__message-block .test-message-count")?.textContent).toBe("1");
    expect(container.querySelector<HTMLElement>('[data-codex-panel-shell-region="toolbar"]')).toBe(toolbar);
    expect(testShell.messageStreamRenderState).toHaveBeenCalledOnce();
    const messageStreamCall = testShell.messageStreamRenderState.mock.calls[0];
    if (!messageStreamCall) throw new Error("Expected the message stream render state to run.");
    expect(messageStreamDisplayItems(messageStreamCall[0].messageStream)).toHaveLength(1);
    expect(testShell.toolbarConnected).not.toHaveBeenCalled();

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

  it("repairs a damaged shell only through an explicit shell render", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    container.querySelector<HTMLElement>(":scope .codex-panel__messages")?.remove();

    await act(async () => {
      store.dispatch({
        type: "message-stream/system-item-added",
        item: { id: "system-1", kind: "system", role: "system", text: "Restored." },
      });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__messages")).toBeNull();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__messages .test-message-count")?.textContent).toBe("1");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("repairs shell ownership markers independently from presentation classes on explicit render", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });
    const messageStream = container.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messageStream).not.toBeNull();
    messageStream?.removeAttribute("data-codex-panel-shell-region");

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "repair marker" });
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector<HTMLElement>('[data-codex-panel-shell-region="message-stream"]')).not.toBe(messageStream);
    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("repair marker");

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

interface TestShellParts {
  parts: ChatPanelShellParts;
  composerRenderState: ReturnType<
    typeof vi.fn<(state: ChatPanelComposerShellState) => ReturnType<ChatPanelShellParts["composer"]["renderState"]>>
  >;
  messageStreamRenderState: ReturnType<
    typeof vi.fn<(state: ChatPanelMessageStreamShellState) => ReturnType<ChatPanelShellParts["messageStream"]["renderState"]>>
  >;
  toolbarConnected: ReturnType<typeof vi.fn<() => boolean>>;
}

function shellParts(): ChatPanelShellParts {
  return trackedShellParts().parts;
}

function trackedShellParts(): TestShellParts {
  const toolbarConnected = vi.fn(() => false);
  const surface = surfaceFixture({ toolbarConnected });
  const messageStreamRenderState = vi.fn((state: ChatPanelMessageStreamShellState) => ({
    blocks: [
      {
        key: "count",
        node: <div className="test-message-count">{String(messageStreamDisplayItems(state.messageStream).length)}</div>,
      },
    ],
    consumeScrollIntent: () => "auto" as const,
  }));
  const composerRenderState = vi.fn((state: ChatPanelComposerShellState) => ({
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
  }));
  return {
    parts: {
      toolbar: surface.toolbar,
      goal: surface.goal,
      messageStream: {
        renderState: messageStreamRenderState,
      },
      composer: {
        renderState: composerRenderState,
      },
    },
    composerRenderState,
    messageStreamRenderState,
    toolbarConnected,
  };
}

function surfaceFixture(options: { toolbarConnected?: () => boolean } = {}): ChatPanelSurface {
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
          startArchiveThread: vi.fn(),
          archiveThread: vi.fn(),
          startRenameThread: vi.fn(),
          updateRenameDraft: vi.fn(),
          saveRenameThread: vi.fn(),
          cancelRenameThread: vi.fn(),
          autoNameThread: vi.fn(),
        },
      },
    },
    goal: {
      settings: { sendShortcut: () => "enter" },
      actions: {
        goal: {
          saveObjective: async () => undefined,
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
        resetReasoningEffortToConfig: async () => undefined,
      },
    },
  };
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
