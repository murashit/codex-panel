// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { ComposerContextReferenceProvider } from "../../../../src/features/chat/application/composer/context-references";
import type { NoteCandidateProvider } from "../../../../src/features/chat/application/composer/note-context";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { ChatComposerController } from "../../../../src/features/chat/panel/composer-controller";
import { type ChatPanelShellParts, renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/panel/shell.dom";
import type { ChatPanelComposerModel } from "../../../../src/features/chat/panel/shell-selectors";
import type { ChatPanelGoalSurface } from "../../../../src/features/chat/panel/surface/goal-projection";
import type { ChatPanelToolbarSurface } from "../../../../src/features/chat/panel/surface/toolbar-projection";
import { threadStreamViewBlocks } from "../../../../src/features/chat/presentation/thread-stream/view-model";
import type { ThreadStreamContext } from "../../../../src/features/chat/ui/thread-stream/context";
import type { ThreadStreamScrollPortBinding } from "../../../../src/features/chat/ui/thread-stream/flow-scroll.measure";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatPanelShell", () => {
  it("composes toolbar, goal, thread stream, and composer in one Preact root", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, shellProps(store));
      await settleShellEffects();
    });

    expect(container.classList.contains("codex-panel")).toBe(true);
    expect(container.querySelector(".codex-panel__toolbar .codex-panel__toolbar-primary")).not.toBeNull();
    expect(container.querySelector(".codex-panel__region--thread-stream")).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer textarea")?.value).toBe("");
    expect(container.querySelector(".codex-panel__thread-stream-block")?.textContent).toContain("Send a message");

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

  it("keeps Tab wikilink insertion before closing brackets through shell selector updates", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const notes = [
      {
        basename: "Beta Note",
        displayName: "Beta Note",
        path: "topics/Beta Note.md",
        mtime: 30,
        linktext: "Beta Note",
        headings: [{ heading: "Overview", linkHeading: "Overview", level: 1 }],
        recentIndex: null,
      },
    ];
    const parts = shellParts();
    parts.composer.presenter = new ChatComposerController({
      noteCandidateProvider: noteProvider({ candidates: () => notes }),
      contextReferenceProvider: contextProvider(),
      sourcePath: () => "",
      stateStore: store,
      viewId: "view",
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: composerProjectionFixture,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });

    await act(async () => {
      renderChatPanelShell(container, { ...shellProps(store), parts });
      await settleShellEffects();
    });

    await act(async () => {
      const input = composer(container);
      setTextAreaValue(input, "[[bet");
      input.setSelectionRange(5, 5);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await settleShellEffects();
    });

    await act(async () => {
      const input = composer(container);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Tab" }));
      await settleShellEffects();
    });

    expect(composer(container).value).toBe("[[Beta Note]]");
    expect(composer(container).selectionStart).toBe("[[Beta Note".length);

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

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: false, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__region--thread-stream")).not.toBeNull();
    expect(container.querySelector(".codex-panel__region--composer")).not.toBeNull();
    const initialComposer = composer(container);
    const initialThreadStream = container.querySelector<HTMLElement>(".codex-panel__region--thread-stream");
    if (!initialThreadStream) throw new Error("Missing thread stream");
    initialComposer.focus();
    initialComposer.setSelectionRange(2, 9);
    initialThreadStream.scrollTop = 42;

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).not.toBeNull();
    expect(container.firstElementChild?.classList.contains("codex-panel__toolbar")).toBe(true);
    expect(document.activeElement).toBe(composer(container));
    expect(composer(container).selectionStart).toBe(2);
    expect(composer(container).selectionEnd).toBe(9);
    expect(container.querySelector<HTMLElement>(".codex-panel__region--thread-stream")?.scrollTop).toBe(42);

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: false, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).toBeNull();
    expect(document.activeElement).toBe(composer(container));
    expect(composer(container).selectionStart).toBe(2);
    expect(composer(container).selectionEnd).toBe(9);
    expect(container.querySelector<HTMLElement>(".codex-panel__region--thread-stream")?.scrollTop).toBe(42);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it.each([
    ["a missing toolbar", (container: HTMLElement) => container.querySelector<HTMLElement>(":scope > .codex-panel__toolbar")?.remove()],
    ["an unexpected root child", (container: HTMLElement) => container.appendChild(document.createElement("section"))],
  ])("repairs %s through an explicit shell render", async (_description, damageRoot) => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const parts = shellParts();

    await act(async () => {
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    damageRoot(container);

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "repair root" });
      renderChatPanelShell(container, { stateStore: store, showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector(".codex-panel__toolbar .codex-panel__toolbar-primary")).not.toBeNull();
    expect(container.querySelector(".codex-panel__body .codex-panel__thread-stream")).not.toBeNull();
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
    threadStream: {
      renderState: (model) => {
        void model.activeThreadCwd;
        return {
          blocks: threadStreamViewBlocks({
            activeThreadId: model.activeThreadId,
            activeTurnId: null,
            historyCursor: model.threadStream.historyCursor,
            loadingHistory: model.threadStream.loadingHistory,
            items: model.threadStream.stableItems,
          }),
          context: testThreadStreamContext,
          scrollPortBinding: noOpThreadStreamScrollPortBinding,
        };
      },
    },
    composer: {
      presenter: {
        renderState: (model) => {
          void model.runtime;
          return {
            viewId: "view",
            draft: model.draft,
            busy: false,
            canInterrupt: false,
            submissionDisabled: false,
            sendDisabled: false,
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
          };
        },
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

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (!descriptor?.set) throw new Error("Missing textarea value setter.");
  descriptor.set.call(textarea, value);
}

function noteProvider(overrides: Partial<NoteCandidateProvider> = {}): NoteCandidateProvider {
  return {
    candidates: () => [],
    dailyNoteReferences: () => [],
    tags: () => [],
    resolveFileReference: () => null,
    dispose: vi.fn(),
    ...overrides,
  };
}

function contextProvider(
  contextReferences: ComposerContextReferenceProvider["contextReferences"] = () => ({ activeNote: null, selection: null }),
): ComposerContextReferenceProvider {
  return {
    contextReferences,
    dispose: vi.fn(),
  };
}

function composerProjectionFixture(_model: ChatPanelComposerModel) {
  return {
    placeholder: "Ask Codex...",
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
    },
  };
}

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

function surfaceFixture(options: { toolbarConnected?: () => boolean; goalSendShortcut?: () => "enter" | "mod-enter" } = {}): {
  toolbar: ChatPanelToolbarSurface;
  goal: ChatPanelGoalSurface;
} {
  return {
    toolbar: {
      connection: {
        connected: options.toolbarConnected ?? (() => false),
      },
      clock: {
        nowMs: () => 0,
      },
      settings: {
        vaultPath: () => "/vault",
        configuredCommand: () => "codex",
        archiveExportEnabled: () => true,
      },
    },
    goal: {
      sendShortcut: options.goalSendShortcut ?? (() => "enter"),
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

function toolbarActionsFixture(): ChatPanelShellParts["toolbar"]["actions"] {
  return {
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
        start: vi.fn(),
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
  };
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
