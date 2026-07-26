// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { diagnosticProbeOk } from "../../../../../src/domain/server/diagnostics";
import type { SkillsMetadataResource } from "../../../../../src/domain/server/metadata";
import type { ComposerContextReferenceProvider } from "../../../../../src/features/chat/application/composer/context-references";
import type { NoteCandidateProvider } from "../../../../../src/features/chat/application/composer/note-context";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { ChatComposerController } from "../../../../../src/features/chat/panel/composer/controller";
import type { ChatPanelGoalDependencies } from "../../../../../src/features/chat/panel/goal/view-projection";
import {
  type ChatPanelShellParts,
  renderChatPanelShell,
  unmountChatPanelShell,
} from "../../../../../src/features/chat/panel/shell/render.dom";
import type { ChatThreadStreamDependencies } from "../../../../../src/features/chat/panel/thread-stream/view-projection";
import type { ChatPanelToolbarDependencies } from "../../../../../src/features/chat/panel/toolbar/view-projection";
import type { ThreadStreamScrollPortBinding } from "../../../../../src/features/chat/ui/thread-stream/flow-scroll.measure";
import { installObsidianDomShims } from "../../../../support/dom";
import { chatSharedSourcesFixture } from "../../support/shared-sources";

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

  it("keeps composer rendering independent from toolbar-only shared resource updates", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const props = shellProps(store);
    const skillListeners = new Set<(resource: SkillsMetadataResource) => void>();
    props.appServerQueries.observeMetadataResource = (id, listener) => {
      if (id !== "skills") return () => undefined;
      const skillListener = listener as (resource: SkillsMetadataResource) => void;
      skillListeners.add(skillListener);
      return () => {
        skillListeners.delete(skillListener);
      };
    };
    const originalPresenter = props.parts.composer.presenter;
    const renderComposer = vi.fn(originalPresenter.renderState);
    props.parts.composer.presenter = { renderState: renderComposer };

    await act(async () => {
      renderChatPanelShell(container, props);
      await settleShellEffects();
    });
    expect(skillListeners.size).toBe(1);
    renderComposer.mockClear();

    await act(async () => {
      for (const listener of skillListeners) {
        listener({
          id: "skills",
          value: [{ name: "writer", description: "", path: "/skills/writer", enabled: true }],
          probe: diagnosticProbeOk("skills", "1 skill", 1),
        });
      }
      await settleShellEffects();
    });

    expect(renderComposer).not.toHaveBeenCalled();
    await act(async () => {
      unmountChatPanelShell(container);
    });
    expect(skillListeners.size).toBe(0);
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
      attachmentHandler: { saveFiles: async () => [] },
      onAttachmentError: vi.fn(),
      noteCandidateProvider: noteProvider({ candidates: () => notes }),
      contextReferenceProvider: contextProvider(),
      sourcePath: () => "",
      stateStore: store,
      viewId: "view",
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      runtimeActions: {
        requestModel: vi.fn(),
        requestReasoningEffort: vi.fn(),
      },
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      sharedResources: {
        runtimeConfigSnapshot: () => null,
        rateLimitsSnapshot: () => undefined,
        modelsSnapshot: () => null,
        skillsSnapshot: () => null,
        permissionProfilesSnapshot: () => null,
        activeThreadsSnapshot: () => null,
        subscribe: () => () => undefined,
      },
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
      renderChatPanelShell(container, { ...shellProps(store), showToolbar: false, parts });
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
      renderChatPanelShell(container, { ...shellProps(store), showToolbar: true, parts });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).not.toBeNull();
    expect(container.firstElementChild?.classList.contains("codex-panel__toolbar")).toBe(true);
    expect(document.activeElement).toBe(composer(container));
    expect(composer(container).selectionStart).toBe(2);
    expect(composer(container).selectionEnd).toBe(9);
    expect(container.querySelector<HTMLElement>(".codex-panel__region--thread-stream")?.scrollTop).toBe(42);

    await act(async () => {
      renderChatPanelShell(container, { ...shellProps(store), showToolbar: false, parts });
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
      renderChatPanelShell(container, { ...shellProps(store), showToolbar: true, parts });
      await settleShellEffects();
    });

    damageRoot(container);

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "repair root" });
      renderChatPanelShell(container, { ...shellProps(store), showToolbar: true, parts });
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
  const sharedSources = sharedSourcesByStore.get(store) ?? chatSharedSourcesFixture();
  sharedSourcesByStore.set(store, sharedSources);
  return {
    stateStore: store,
    ...sharedSources,
    showToolbar: true,
    parts: shellParts(),
  };
}

const sharedSourcesByStore = new WeakMap<ReturnType<typeof createChatStateStore>, ReturnType<typeof chatSharedSourcesFixture>>();

function shellParts(
  options: { toolbarConnected?: () => boolean; goalSendShortcut?: () => "enter" | "mod-enter" } = {},
): ChatPanelShellParts {
  const surface = surfaceFixture(options);
  return {
    toolbar: {
      dependencies: surface.toolbar,
      actions: toolbarActionsFixture(),
    },
    goal: surface.goal,
    threadStream: {
      context: testThreadStreamContext,
      scrollPortBinding: noOpThreadStreamScrollPortBinding,
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

function surfaceFixture(options: { toolbarConnected?: () => boolean; goalSendShortcut?: () => "enter" | "mod-enter" } = {}): {
  toolbar: ChatPanelToolbarDependencies;
  goal: ChatPanelGoalDependencies;
} {
  return {
    toolbar: {
      connection: {
        connected: options.toolbarConnected ?? (() => false),
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
        start: vi.fn(),
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
  };
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
