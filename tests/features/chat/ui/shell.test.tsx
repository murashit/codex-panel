// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { signal } from "@preact/signals";

import { createChatStateStore } from "../../../../src/features/chat/state/reducer";
import { renderChatPanelShell, unmountChatPanelShell, type ChatPanelShellSlots } from "../../../../src/features/chat/ui/shell";
import type { ChatPanelSurfacePorts } from "../../../../src/features/chat/panel/surface/ports";
import { installObsidianDomShims } from "../../../support/dom";
import { chatStateDisplayItems } from "../support/message-stream";

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
    const slots = shellSlots(store);
    const composerRenderState = vi.spyOn(slots.composer, "renderState");

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, slots });
      await settleShellEffects();
    });
    composerRenderState.mockClear();

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
    expect(composerRenderState).toHaveBeenCalled();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("does not invalidate unrelated shell surfaces for composer-only state changes", async () => {
    const store = createChatStateStore();
    store.dispatch({
      type: "thread-list/applied",
      threads: [{ id: "thread-1", name: "Thread", preview: "", archived: false, createdAt: 1, updatedAt: 1 }],
    });
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renameState = vi.fn(() => null);
    const slots = shellSlots(store, { toolbarRenameState: renameState });
    const composerRenderState = vi.spyOn(slots.composer, "renderState");
    const messageStreamRenderState = vi.spyOn(slots.messageStream, "renderState");

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, slots });
      await settleShellEffects();
    });
    renameState.mockClear();
    composerRenderState.mockClear();
    messageStreamRenderState.mockClear();

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "composer only", clearSuggestions: true });
      await settleShellEffects();
    });

    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("composer only");
    expect(composerRenderState).toHaveBeenCalled();
    expect(messageStreamRenderState).not.toHaveBeenCalled();
    expect(renameState).not.toHaveBeenCalled();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("removes and restores the toolbar from shell props without replacing the body regions", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const slots = shellSlots(store);

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: false, slots });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__region--message-stream")).not.toBeNull();
    expect(container.querySelector(".codex-panel__region--composer")).not.toBeNull();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, slots });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).not.toBeNull();
    expect(container.firstElementChild?.classList.contains("codex-panel__toolbar")).toBe(true);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("repairs a damaged shell through the single root", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const slots = shellSlots(store);

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, slots });
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

    expect(container.querySelector(".codex-panel__messages .test-message-count")?.textContent).toBe("1");

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
    slots: shellSlots(store),
  };
}

interface ShellSlotsOptions {
  toolbarRenameState?: () => null;
}

function shellSlots(store: ReturnType<typeof createChatStateStore>, options: ShellSlotsOptions = {}): ChatPanelShellSlots {
  const ports = surfacePorts(store, options);
  return {
    toolbar: ports.toolbar,
    goal: ports.goal,
    messageStream: {
      renderState: () => ({
        blocks: [
          {
            key: "count",
            node: <div className="test-message-count">{String(chatStateDisplayItems(store.getState()).length)}</div>,
          },
        ],
        consumeScrollIntent: () => "auto",
      }),
    },
    composer: {
      renderState: () => ({
        viewId: "view",
        draft: store.getState().composer.draft,
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

function surfacePorts(store: ReturnType<typeof createChatStateStore>, options: ShellSlotsOptions): ChatPanelSurfacePorts {
  return {
    toolbar: {
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
          archiveConfirm: signal(null),
          renameState: options.toolbarRenameState ?? (() => null),
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

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
