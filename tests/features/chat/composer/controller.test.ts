// @vitest-environment jsdom

import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ChatComposerController } from "../../../../src/features/chat/composer/controller";
import { createChatStateStore } from "../../../../src/features/chat/chat-state";
import type { SkillMetadata } from "../../../../src/generated/app-server/v2/SkillMetadata";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();

describe("ChatComposerController", () => {
  it("keeps suggestions closed after inserting at a cursor before later trigger text", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "connection/metadata-applied", availableSkills: [skill("obsidian-search")] });
    stateStore.dispatch({ type: "composer/draft-set", draft: "/pla then $ob" });
    const parent = document.createElement("div");
    const controller = new ChatComposerController({
      app: app(),
      stateStore,
      viewId: "view",
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      canInterrupt: () => false,
      composerPlaceholder: () => "Ask Codex to work on this task...",
      composerMeta: () => ({
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
      }),
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      renderIfDetached: vi.fn(),
      onDraftChange: vi.fn(),
      onComposerResize: vi.fn(),
      onSubmit: vi.fn(),
      onThreadScrollFromComposer: vi.fn(),
    });

    controller.render(parent);
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
      canInterrupt: () => false,
      composerPlaceholder: () => "Ask Codex to work on this task...",
      composerMeta: () => ({
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
      }),
      currentModelForSuggestions: () => null,
      togglePlan,
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      renderIfDetached: vi.fn(),
      onDraftChange: vi.fn(),
      onComposerResize: vi.fn(),
      onSubmit: vi.fn(),
      onThreadScrollFromComposer: vi.fn(),
    });

    controller.render(parent);
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.classList.contains("is-active")).toBe(false);

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(togglePlan).toHaveBeenCalledOnce();
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.classList.contains("is-active")).toBe(false);
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
    scope: "repo",
    enabled: true,
  };
}

function composer(parent: HTMLElement): HTMLTextAreaElement {
  return expectPresent(parent.querySelector<HTMLTextAreaElement>(".codex-panel__composer-input"));
}

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as T;
}
