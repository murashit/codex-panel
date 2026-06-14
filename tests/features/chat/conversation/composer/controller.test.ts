// @vitest-environment jsdom

import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { h } from "preact";

import { ChatComposerController, type ChatComposerRenderActions } from "../../../../../src/features/chat/ui/composer-controller";
import { ComposerShell } from "../../../../../src/features/chat/ui/composer";
import { createChatStateStore, type ChatStateStore } from "../../../../../src/features/chat/application/state/reducer";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root";
import type { SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import { installObsidianDomShims } from "../../../../support/dom";
import type { ChatPanelComposerShellState } from "../../../../../src/features/chat/ui/shell-state";

installObsidianDomShims();

function renderComposerController(
  parent: HTMLElement,
  controller: ChatComposerController,
  stateStore: ChatStateStore,
  actions: ChatComposerRenderActions = { submit: vi.fn() },
): void {
  renderUiRoot(parent, h(ComposerShell, controller.renderState(stateStore.getState(), actions)));
}

describe("ChatComposerController", () => {
  it("derives composer placeholder and meta from one projection per render", () => {
    const stateStore = createChatStateStore();
    const projection = vi.fn((state: ChatPanelComposerShellState) => ({
      placeholder: `Projected ${state.composer.draft || "empty"}`,
      meta: defaultComposerProjection(state).meta,
    }));
    const controller = new ChatComposerController({
      app: app(),
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

    const props = controller.renderState(stateStore.getState(), { submit: vi.fn() });

    expect(projection).toHaveBeenCalledOnce();
    expect(props.normalPlaceholder).toBe("Projected empty");
    expect(props.meta.statusSummary).toBe(
      "Context unavailable, plan off, auto-review off, fast off, model default, reasoning effort default",
    );
  });

  it("updates slash suggestions in the same render as the input", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const controllerRef: { current: ChatComposerController | null } = { current: null };
    const renderShell = vi.fn(() => {
      if (!controllerRef.current) throw new Error("Expected controller.");
      renderComposerController(parent, controllerRef.current, stateStore);
    });
    const controller = new ChatComposerController({
      app: app(),
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
    expect(renderShell).toHaveBeenCalledTimes(2);
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
      app: app(),
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
      app: app(),
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

  it("delegates composer runtime toggles without forcing a local rerender", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const togglePlan = vi.fn();
    const controller = new ChatComposerController({
      app: app(),
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
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.classList.contains("is-active")).toBe(false);

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(togglePlan).toHaveBeenCalledOnce();
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.classList.contains("is-active")).toBe(false);
  });

  it("delegates submit events through render actions", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "composer/draft-set", draft: "hello" });
    const parent = document.createElement("div");
    const submit = vi.fn();
    const controller = new ChatComposerController({
      app: app(),
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

  it("clears the Preact-owned textarea ref when the composer unmounts", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "composer/draft-set", draft: "state draft" });
    const parent = document.createElement("div");
    const controller = new ChatComposerController({
      app: app(),
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

function app(): App {
  return {
    workspace: {
      getActiveFile: () => null,
      getLastOpenFiles: () => [],
    },
    vault: {
      getFiles: () => [],
    },
  } as unknown as App;
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
