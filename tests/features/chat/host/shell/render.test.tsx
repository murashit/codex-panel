// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  type ChatPanelShellParts,
  renderChatPanelShell,
  unmountChatPanelShell,
} from "../../../../../src/features/chat/host/shell/render.dom";
import type { ThreadStreamScrollPortBinding } from "../../../../../src/features/chat/ui/thread-stream/flow-scroll";
import { installObsidianDomShims } from "../../../../support/dom";
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

  it("refreshes the archive default in a mounted shell when the save preference changes", async () => {
    const store = createChatStateStore();
    store.dispatch({ type: "ui/panel-set", panel: "history" });
    store.dispatch({ type: "ui/archive-confirm-set", threadId: "thread" });
    const container = document.body.appendChild(document.createElement("div"));
    let saveMarkdown = true;
    const props = {
      ...shellProps(store),
      ...chatSharedSourcesFixture([
        {
          id: "thread",
          name: "Thread",
          preview: "",
          archived: false,
          ephemeral: false,
          provenance: { kind: "interactive" },
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      parts: shellParts({ archiveExportEnabled: () => saveMarkdown }),
    };

    await act(async () => {
      renderChatPanelShell(container, props);
      await settleShellEffects();
    });
    expect(container.querySelector(".codex-panel__archive-default")?.getAttribute("aria-label")).toBe("Save and archive thread");

    saveMarkdown = false;
    await act(async () => {
      renderChatPanelShell(container, props);
      await settleShellEffects();
    });
    expect(container.querySelector(".codex-panel__archive-default")?.getAttribute("aria-label")).toBe("Archive thread without saving");
    await act(async () => unmountChatPanelShell(container));
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
