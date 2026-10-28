// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/transition-actions";
import { createThreadRenameEditorActions } from "../../../../../src/features/chat/host/session/rename-editor";
import {
  type ChatPanelShellParts,
  renderChatPanelShell,
  unmountChatPanelShell,
} from "../../../../../src/features/chat/host/shell/render.dom";
import { createToolbarPanelActions, createToolbarUiActions } from "../../../../../src/features/chat/host/toolbar/actions";
import type { ThreadStreamScrollPortBinding } from "../../../../../src/features/chat/ui/thread-stream/flow-scroll";
import { installObsidianDomShims } from "../../../../support/dom";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { composerPropsFixture } from "../../support/composer-shell";
import { chatSharedSourcesFixture } from "../../support/shared-sources";
import { threadStreamDependenciesFixture } from "../../support/thread-stream-dependencies";
import { toolbarActionsFixture } from "../../support/toolbar-actions";

installObsidianDomShims();

describe("ChatPanelShell", () => {
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
        type: "thread-stream/system-item-added",
        item: { id: "system-1", kind: "system", role: "system", text: "Model set." },
      });
      await settleShellEffects();
    });

    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("ready");
    expect(container.querySelector(".codex-panel__thread-stream-block")?.textContent).toContain("Model set.");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("removes and restores the toolbar without losing composer or thread viewport state", async () => {
    const store = createChatStateStore();
    store.dispatch({ type: "composer/draft-set", draft: "toolbar continuity" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();
    const props = shellProps(store);

    await act(async () => {
      renderChatPanelShell(container, { ...props, showToolbar: false, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__conversation-title")?.textContent).toBe("New chat");
    const initialHeader = container.querySelector(".codex-panel__conversation-header");
    expect(container.querySelector(".codex-panel__region--thread-stream")).not.toBeNull();
    expect(container.querySelector(".codex-panel__region--composer")).not.toBeNull();
    const initialComposer = composer(container);
    const initialThreadStream = container.querySelector<HTMLElement>(".codex-panel__region--thread-stream");
    if (!initialThreadStream) throw new Error("Missing thread stream");
    initialComposer.focus();
    initialComposer.setSelectionRange(2, 9);
    initialThreadStream.scrollTop = 42;

    await act(async () => {
      renderChatPanelShell(container, { ...props, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).not.toBeNull();
    expect(container.querySelector(".codex-panel__conversation-header")).toBe(initialHeader);
    expect(document.activeElement).toBe(composer(container));
    expect(composer(container).selectionStart).toBe(2);
    expect(composer(container).selectionEnd).toBe(9);
    expect(container.querySelector<HTMLElement>(".codex-panel__region--thread-stream")?.scrollTop).toBe(42);

    await act(async () => {
      renderChatPanelShell(container, { ...props, showToolbar: false, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__conversation-header")).toBe(initialHeader);
    expect(document.activeElement).toBe(composer(container));
    expect(composer(container).selectionStart).toBe(2);
    expect(composer(container).selectionEnd).toBe(9);
    expect(container.querySelector<HTMLElement>(".codex-panel__region--thread-stream")?.scrollTop).toBe(42);

    await act(async () => {
      renderChatPanelShell(container, { ...props, showToolbar: true, parts });
      await settleShellEffects();
    });
    await act(async () => {
      store.dispatch({ type: "ui/panel-set", panel: "history" });
      store.dispatch({ type: "ui/goal-editor-started", threadId: null, objective: "A goal", tokenBudget: null });
      await settleShellEffects();
    });
    const toolbar = container.querySelector(".codex-panel__toolbar");
    const heading = container.querySelector(".codex-panel__region--heading");
    const goal = container.querySelector(".codex-panel__goal");
    expect(toolbar?.querySelector('[data-codex-panel-toolbar-panel="history"]')).not.toBeNull();
    expect(heading?.firstElementChild).toBe(initialHeader);
    expect(heading?.contains(goal)).toBe(true);
    expect(toolbar?.contains(initialHeader)).toBe(false);
    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("uses the archive preference and forwards header confirmation choices for the current thread", async () => {
    const store = createChatStateStore();
    const thread = panelThreadFixture({ id: "thread", name: "Thread" });
    store.dispatch(resumedThreadAction({ response: threadActivationFixture(thread) }));
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    const container = document.body.appendChild(document.createElement("div"));
    let saveMarkdown = true;
    const parts = shellParts({ archiveExportEnabled: () => saveMarkdown });
    parts.toolbar.actions.threads.archive.confirm = vi.fn(() => {
      store.dispatch({ type: "ui/archive-confirm-set", threadId: null });
    });
    const props = { ...shellProps(store), ...chatSharedSourcesFixture([thread]), parts };

    try {
      await act(async () => {
        renderChatPanelShell(container, props);
        await settleShellEffects();
      });
      const header = container.querySelector<HTMLElement>(".codex-panel__conversation-header");
      const archive = header?.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]');
      archive?.focus();
      archive?.click();
      expect(parts.toolbar.actions.threads.archive.start).toHaveBeenCalledWith("thread");
      await act(async () => {
        store.dispatch({ type: "ui/archive-confirm-set", threadId: "thread" });
        await settleShellEffects();
      });
      expect(header?.querySelector(".codex-panel__archive-default")?.getAttribute("aria-label")).toBe("Save and archive thread");
      expect(document.activeElement).toBe(header?.querySelector(".codex-panel__archive-default"));
      await act(async () => {
        header?.querySelector<HTMLButtonElement>('[aria-label="Save and archive thread"]')?.click();
        await settleShellEffects();
      });
      expect(document.activeElement).toBe(header?.querySelector('[aria-label="Archive thread"]'));
      expect(parts.toolbar.actions.threads.archive.confirm).toHaveBeenNthCalledWith(1, "thread", true);
      await act(async () => {
        store.dispatch({ type: "ui/archive-confirm-set", threadId: "thread" });
        await settleShellEffects();
      });
      await act(async () => {
        const alternate = header?.querySelector<HTMLButtonElement>('[aria-label="Archive thread without saving"]');
        alternate?.focus();
        alternate?.click();
        await settleShellEffects();
      });
      expect(document.activeElement).toBe(header?.querySelector('[aria-label="Archive thread"]'));
      expect(parts.toolbar.actions.threads.archive.confirm).toHaveBeenNthCalledWith(2, "thread", false);
      await act(async () => {
        store.dispatch({ type: "ui/archive-confirm-set", threadId: "thread" });
        await settleShellEffects();
      });
      saveMarkdown = false;
      await act(async () => {
        renderChatPanelShell(container, props);
        await settleShellEffects();
      });
      expect(header?.querySelector(".codex-panel__archive-default")?.getAttribute("aria-label")).toBe("Archive thread without saving");
      composer(container).focus();
      await act(async () => {
        store.dispatch({ type: "ui/archive-confirm-set", threadId: null });
        store.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
        await settleShellEffects();
      });
      expect(document.activeElement).toBe(composer(container));
      expect(header?.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.disabled).toBe(true);
    } finally {
      await act(async () => unmountChatPanelShell(container));
      container.remove();
    }
  });

  it("keeps the temporary choice before start and offers no thread actions to a started temporary chat", async () => {
    const store = createChatStateStore();
    const container = document.body.appendChild(document.createElement("div"));
    try {
      await act(async () => {
        renderChatPanelShell(container, shellProps(store));
        await settleShellEffects();
      });
      const header = container.querySelector<HTMLElement>(".codex-panel__conversation-header");
      await act(async () => {
        header?.querySelector<HTMLButtonElement>('[aria-label="Use temporary conversation"]')?.click();
        await settleShellEffects();
      });
      expect(store.getState().panelThread).toMatchObject({ kind: "empty", ephemeral: true });
      expect(header?.querySelector('[aria-label="Rename thread"]')).toBeNull();
      const temporary = panelThreadFixture({ id: "temporary", ephemeral: true });
      await act(async () => {
        store.dispatch(resumedThreadAction({ response: threadActivationFixture(temporary) }));
        await settleShellEffects();
      });
      expect(header?.querySelectorAll("button")).toHaveLength(0);
      expect(header?.querySelector('[aria-label="Temporary conversation"]')).not.toBeNull();
    } finally {
      await act(async () => unmountChatPanelShell(container));
      container.remove();
    }
  });

  it("keeps one focused rename editor at the initiating surface through a failed save", async () => {
    const store = createChatStateStore();
    const thread = panelThreadFixture({ id: "current", name: "Current" });
    const other = panelThreadFixture({ id: "other", name: "Other" });
    store.dispatch(resumedThreadAction({ response: threadActivationFixture(thread) }));
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    let rejectSave: (error: Error) => void = () => undefined;
    const rename = createThreadRenameEditorActions({
      stateStore: store,
      threadById: (id) => (id === thread.id ? thread : id === other.id ? other : undefined),
      ensureConnected: async () => undefined,
      addSystemMessage: vi.fn(),
      resolveThreadTitleContext: async () => ({ userRequest: "Question", assistantResponse: "Answer" }),
      generateThreadTitle: (_context, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
      renameThread: () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    });
    const parts = shellParts();
    parts.toolbar.actions = createToolbarUiActions({
      rename,
      connectionCoordinator: {} as never,
      reconnectCommand: vi.fn(),
      threadCommands: {} as never,
      goals: {} as never,
      toolbarPanel: createToolbarPanelActions({ stateStore: store, threadCommands: {} as never }),
      navigation: {} as never,
      loadMoreThreads: async () => undefined,
      openSideChat: vi.fn(),
      debugDetails: {} as never,
    });
    const container = document.body.appendChild(document.createElement("div"));
    try {
      await act(async () => {
        renderChatPanelShell(container, { ...shellProps(store), ...chatSharedSourcesFixture([thread, other]), parts });
        await settleShellEffects();
      });
      const headerActions = container.querySelector(".codex-panel__conversation-header");
      expect(headerActions?.querySelector('[aria-label="Rename thread"]')).not.toBeNull();
      expect(headerActions?.querySelector('[aria-label="Archive thread"]')).not.toBeNull();
      expect(headerActions?.querySelector('[aria-label="Pin thread"], [aria-label="Unpin thread"]')).toBeNull();
      expect(container.querySelector('.codex-panel__toolbar [aria-label="Pin thread"]')).not.toBeNull();
      for (const origin of ["toolbar", "header"] as const) {
        const area = container.querySelector<HTMLElement>(
          origin === "header" ? ".codex-panel__conversation-header" : ".codex-panel__toolbar",
        );
        await act(async () => {
          area?.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
          await settleShellEffects();
        });
        const inputs = container.querySelectorAll<HTMLInputElement>(".codex-panel-ui__nav-inline-input");
        expect(inputs).toHaveLength(1);
        expect(area?.contains(inputs[0] ?? null)).toBe(true);
        expect(document.activeElement).toBe(inputs[0]);
        const labelId = inputs[0]?.getAttribute("aria-labelledby");
        expect(labelId && document.getElementById(labelId)?.textContent).toBe("Thread name");
        expect(inputs[0]?.hasAttribute("aria-label")).toBe(false);
        expect(inputs[0]?.hasAttribute("title")).toBe(false);
        await act(async () => {
          inputs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await settleShellEffects();
        });
      }
      const header = container.querySelector<HTMLElement>(".codex-panel__conversation-header");
      await act(async () => {
        header?.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
        await settleShellEffects();
      });
      await act(async () => {
        header?.querySelector<HTMLInputElement>("input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await settleShellEffects();
      });
      expect(header?.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
      await act(async () => {
        rejectSave(new Error("offline"));
        await settleShellEffects();
      });
      expect(container.querySelectorAll(".codex-panel-ui__nav-inline-input")).toHaveLength(1);
      expect(document.activeElement).toBe(header?.querySelector("input"));
      await act(async () => {
        rename.cancel(thread.id);
        store.dispatch({ type: "ui/panel-set", panel: "history" });
        rename.start(other.id);
        await settleShellEffects();
      });
      const otherInput = container.querySelector<HTMLInputElement>(".codex-panel__toolbar .codex-panel-ui__nav-inline-input");
      await act(async () => {
        otherInput?.blur();
        await settleShellEffects();
      });
      expect(otherInput?.disabled).toBe(true);
      expect(header?.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.disabled).toBe(true);
      await act(async () => {
        rejectSave(new Error("offline"));
        await settleShellEffects();
      });
      expect(document.activeElement).toBe(container.querySelector(".codex-panel__toolbar .codex-panel-ui__nav-inline-input"));
      await act(async () => {
        rename.cancel(other.id);
        await settleShellEffects();
      });
      await act(async () => {
        header?.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
        await settleShellEffects();
      });
      await act(async () => {
        header?.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
        await settleShellEffects();
      });
      expect(header?.querySelector('[aria-label="Cancel auto-name"]')).not.toBeNull();
      await act(async () => {
        parts.toolbar.actions.primary.toggleHistory();
        await settleShellEffects();
      });
      const toolbar = container.querySelector<HTMLElement>(".codex-panel__toolbar");
      await act(async () => {
        toolbar?.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]')?.click();
        await settleShellEffects();
      });
      expect(document.activeElement).toBe(toolbar?.querySelector(".codex-panel-ui__nav-inline-input"));
    } finally {
      await act(async () => unmountChatPanelShell(container));
      container.remove();
    }
  });

  it("keeps history open when the rename editor declines a header request", async () => {
    const store = createChatStateStore();
    const thread = panelThreadFixture({ id: "thread", name: "Thread" });
    store.dispatch(resumedThreadAction({ response: threadActivationFixture(thread) }));
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    const parts = shellParts();
    parts.toolbar.actions.threads.rename.start = vi.fn(() => false);
    const container = document.body.appendChild(document.createElement("div"));
    try {
      await act(async () => {
        renderChatPanelShell(container, { ...shellProps(store), ...chatSharedSourcesFixture([thread]), parts });
        await settleShellEffects();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('.codex-panel__conversation-header [aria-label="Rename thread"]')?.click();
        await settleShellEffects();
      });
      expect(parts.toolbar.actions.threads.rename.start).toHaveBeenCalledWith("thread");
      expect(parts.toolbar.actions.primary.toggleHistory).not.toHaveBeenCalled();
    } finally {
      await act(async () => unmountChatPanelShell(container));
      container.remove();
    }
  });

  it("sets composer bottom clearance only for fixed visible Obsidian status bars", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const statusBar = document.createElement("div");
    const props = shellProps(store);
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
      renderChatPanelShell(container, props);
      await settleShellEffects();
    });
    expect(container.style.getPropertyValue("--codex-panel-status-bar-clearance")).toBe("26px");

    await act(async () => {
      statusBar.style.position = "static";
      renderChatPanelShell(container, props);
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
    ...chatSharedSourcesFixture(),
    showToolbar: true,
    parts: shellParts(),
  };
}

function shellParts(options: { archiveExportEnabled?: () => boolean } = {}): ChatPanelShellParts {
  return {
    toolbar: {
      dependencies: {
        connection: {
          connected: () => false,
        },
        visibleThreadId: (_threads, threadId) => threadId,
        settings: {
          vaultPath: () => "/vault",
          configuredCommand: () => "codex",
          archiveExportEnabled: options.archiveExportEnabled ?? (() => true),
        },
      },
      actions: toolbarActionsFixture(),
    },
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
    threadStream: {
      context: threadStreamDependenciesFixture(),
      scrollPortBinding: noOpThreadStreamScrollPortBinding,
    },
    composer: {
      presenter: {
        renderState: (model) => composerPropsFixture({ draft: model.draft }),
      },
      actions: {
        submit: vi.fn(),
      },
    },
  };
}

function composer(container: HTMLElement): HTMLTextAreaElement {
  const input = container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea");
  if (!input) throw new Error("Expected composer input.");
  return input;
}

const noOpThreadStreamScrollPortBinding: ThreadStreamScrollPortBinding = {
  mountScrollPort: () => () => undefined,
};

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
