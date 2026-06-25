// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it, vi } from "vitest";
import type { SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import type { NoteCandidateProvider } from "../../../../../src/features/chat/application/composer/note-context";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { ChatComposerController, type ChatComposerRenderActions } from "../../../../../src/features/chat/panel/composer-controller";
import type { ChatPanelComposerShellState } from "../../../../../src/features/chat/panel/shell-state";
import { ComposerShell } from "../../../../../src/features/chat/ui/composer";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root.dom";
import { installObsidianDomShims } from "../../../../support/dom";
import { composerShellStateFromChatState } from "../../support/shell-state";

installObsidianDomShims();

function renderComposerController(
  parent: HTMLElement,
  controller: ChatComposerController,
  stateStore: ChatStateStore,
  actions: ChatComposerRenderActions = { submit: vi.fn() },
): void {
  renderUiRoot(parent, h(ComposerShell, controller.renderState(composerShellStateFromChatState(stateStore.getState()), actions)));
}

describe("ChatComposerController", () => {
  it("derives composer placeholder and meta from the projection", () => {
    const stateStore = createChatStateStore();
    const projection = vi.fn((state: ChatPanelComposerShellState) => ({
      placeholder: `Projected ${state.composer.draft || "empty"}`,
      meta: defaultComposerProjection(state).meta,
    }));
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: projection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });

    const props = controller.renderState(composerShellStateFromChatState(stateStore.getState()), { submit: vi.fn() });

    expect(props.normalPlaceholder).toBe("Projected empty");
    expect(props.meta.statusSummary).toBe(
      "Context unavailable, plan off, auto-review off, fast off, model default, reasoning effort default",
    );
  });

  it("updates slash suggestions when the input changes", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const controllerRef: { current: ChatComposerController | null } = { current: null };
    const renderShell = vi.fn(() => {
      if (!controllerRef.current) throw new Error("Expected controller.");
      renderComposerController(parent, controllerRef.current, stateStore);
    });
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });
    controllerRef.current = controller;
    stateStore.subscribe(renderShell);

    renderShell();
    setTextAreaValue(composer(parent), "/");
    composer(parent).setSelectionRange(1, 1);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    expect(stateStore.getState().composer.draft).toBe("/");
    expect(stateStore.getState().composer.suggestions.length).toBeGreaterThan(0);
    expect(parent.querySelector(".codex-panel__composer-suggestion")?.textContent).toContain("/");
  });

  it("rerenders suggestion selection from keyboard navigation", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });
    stateStore.subscribe(renderShell);

    renderShell();
    setTextAreaValue(composer(parent), "/");
    composer(parent).setSelectionRange(1, 1);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    const firstSelected = selectedSuggestion(parent);
    expect(firstSelected.textContent).toContain("/clear");

    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    expect(stateStore.getState().composer.suggestSelected).toBe(1);
    expect(selectedSuggestion(parent).textContent).not.toBe(firstSelected.textContent);

    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true }));
    expect(stateStore.getState().composer.suggestSelected).toBe(0);
    expect(selectedSuggestion(parent).textContent).toBe(firstSelected.textContent);
  });

  it("keeps suggestions closed after inserting at a cursor before later trigger text", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "connection/metadata-applied", availableSkills: [skill("obsidian-search")] });
    stateStore.dispatch({ type: "composer/draft-set", draft: "/pla then $ob" });
    const parent = document.createElement("div");
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });
    stateStore.subscribe(renderShell);

    renderShell();
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));

    const planSuggestion = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__composer-suggestion"));
    expect(planSuggestion.textContent).toContain("/plan");

    planSuggestion.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(composer(parent).value).toBe("/plan then $ob");
    expect(composer(parent).selectionStart).toBe("/plan".length);
    expect(stateStore.getState().composer.suggestions).toEqual([]);
    expect(composer(parent).getAttribute("aria-expanded")).toBe("false");
    expect(composer(parent).hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("delegates composer runtime toggles", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const togglePlan = vi.fn();
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan,
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });

    renderComposerController(parent, controller, stateStore);

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(togglePlan).toHaveBeenCalledOnce();
  });

  it("delegates submit events through render actions", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "composer/draft-set", draft: "hello" });
    const parent = document.createElement("div");
    const submit = vi.fn();
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });

    renderComposerController(parent, controller, stateStore, { submit });
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));

    expect(submit).toHaveBeenCalledOnce();
  });

  it("scrolls by page from the composer even when line edge scrolling is disabled", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const threadScrollFromComposer = vi.fn();
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer,
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "first\nsecond");
    composer(parent).setSelectionRange(3, 3);
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "PageDown" });
    composer(parent).dispatchEvent(event);

    expect(threadScrollFromComposer).toHaveBeenCalledWith({ kind: "scroll-by", direction: 1, amount: "page" });
    expect(event.defaultPrevented).toBe(true);
  });

  it("scrolls to stream edges from the composer even when line edge scrolling is disabled", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const threadScrollFromComposer = vi.fn();
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer,
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "first\nsecond");
    composer(parent).setSelectionRange(3, 8);
    const home = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Home" });
    composer(parent).dispatchEvent(home);
    const end = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" });
    composer(parent).dispatchEvent(end);

    expect(threadScrollFromComposer).toHaveBeenNthCalledWith(1, { kind: "scroll-to", edge: "start" });
    expect(threadScrollFromComposer).toHaveBeenNthCalledWith(2, { kind: "scroll-to", edge: "end" });
    expect(home.defaultPrevented).toBe(true);
    expect(end.defaultPrevented).toBe(true);
  });

  it("leaves composer line edge scrolling disabled by the setting", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const threadScrollFromComposer = vi.fn();
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer,
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "first\nsecond");
    composer(parent).setSelectionRange("first\nsecond".length, "first\nsecond".length);
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "n", ctrlKey: true });
    composer(parent).dispatchEvent(event);

    expect(threadScrollFromComposer).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("clears the Preact-owned textarea ref when the composer unmounts", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "composer/draft-set", draft: "state draft" });
    const parent = document.createElement("div");
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      onDraftChange: vi.fn(),
      onHeightChange: vi.fn(),
    });

    renderComposerController(parent, controller, stateStore);
    const mountedComposer = composer(parent);
    setTextAreaValue(mountedComposer, "stale dom draft");
    const focus = vi.spyOn(mountedComposer, "focus");

    unmountUiRoot(parent);
    controller.setDraft("state draft", { focus: true });

    expect(controller.trimmedDraft).toBe("state draft");
    expect(focus).not.toHaveBeenCalled();
  });
});

function noteProvider(): NoteCandidateProvider {
  return {
    candidates: () => [],
    resolveMention: () => null,
    dispose: vi.fn(),
  };
}

function skill(name: string): SkillMetadata {
  return {
    name,
    description: `${name} description`,
    path: `/vault/skills/${name}/SKILL.md`,
    enabled: true,
  };
}

function defaultComposerProjection(_state: ChatPanelComposerShellState) {
  return {
    placeholder: "Ask Codex to work on this task...",
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

function composer(parent: HTMLElement): HTMLTextAreaElement {
  return expectPresent(parent.querySelector<HTMLTextAreaElement>(".codex-panel__composer-input"));
}

function selectedSuggestion(parent: HTMLElement): HTMLElement {
  return expectPresent(parent.querySelector<HTMLElement>(".codex-panel__composer-suggestion.is-selected"));
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (!descriptor?.set) throw new Error("Missing textarea value setter.");
  descriptor.set.call(textarea, value);
}

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as T;
}
