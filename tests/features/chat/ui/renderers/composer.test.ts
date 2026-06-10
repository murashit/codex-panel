// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  composerShellNode,
  scrollComposerSuggestionIntoView,
  syncComposerHeight,
  type ComposerCallbacks,
} from "../../../../../src/features/chat/ui/composer";
import type { ComposerSuggestion } from "../../../../../src/features/chat/composer/suggestions";
import type { ComposerMetaViewModel } from "../../../../../src/features/chat/panel/model";
import { renderUiRoot } from "../../../../../src/shared/ui/ui-root";
import { waitForAsyncWork } from "../../../../support/async";
import { changeInputValue, composerSuggestionScrollFixture, installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

function mountComposerShellNode(
  parent: HTMLElement,
  viewId: string,
  draft: string,
  busy: boolean,
  canInterrupt: boolean,
  normalPlaceholder: string,
  suggestions: readonly ComposerSuggestion[],
  selectedSuggestionIndex: number,
  callbacks: ComposerCallbacks,
  meta?: ComposerMetaViewModel,
): { composer: HTMLTextAreaElement } {
  const elements: { composer: HTMLTextAreaElement | null } = { composer: null };
  renderUiRoot(
    parent,
    composerShellNode(
      viewId,
      draft,
      busy,
      canInterrupt,
      normalPlaceholder,
      suggestions,
      selectedSuggestionIndex,
      callbacks,
      meta,
      (composer) => {
        if (composer) elements.composer = composer;
      },
    ),
  );
  if (!elements.composer) throw new Error("Expected composer shell elements to mount.");
  return { composer: elements.composer };
}

function composerCallbacks() {
  return {
    onInput: vi.fn(),
    onUpdateSuggestions: vi.fn(),
    onKeydown: vi.fn(),
    onSendOrInterrupt: vi.fn(),
    onHeightChange: vi.fn(),
    onTogglePlan: vi.fn(),
    onToggleAutoReview: vi.fn(),
    onToggleFast: vi.fn(),
    onSuggestionHover: vi.fn(),
    onSuggestionInsert: vi.fn(),
  };
}

describe("composer renderer decisions", () => {
  it("uses the provided composer placeholder for normal input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShellNode(
      parent,
      "view",
      "",
      false,
      false,
      "Ask Codex to work on “Refactor terminal streaming”...",
      [],
      0,
      callbacks,
    );

    expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Refactor terminal streaming”...");

    mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on “Renamed thread”...", [], 0, callbacks);

    expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Renamed thread”...");
  });

  it("renders composer meta as interactive context and runtime text without changing normal text", () => {
    const parent = document.createElement("div");

    mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, composerCallbacks(), {
      fatal: null,
      context: {
        cells: [
          { text: "⣿", placeholder: false },
          { text: "⣶", placeholder: false },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: "42%",
      },
      statusSummary: "Context 42%, plan on, auto-review off, fast on, model gpt-5.5, reasoning effort high",
      model: "gpt-5.5",
      effort: "high",
      planActive: true,
      autoReviewActive: false,
      fastActive: true,
      modelChoices: [
        { label: "gpt-5.5", selected: true, onClick: vi.fn() },
        { label: "gpt-5.4", onClick: vi.fn() },
      ],
      effortChoices: [
        { label: "medium", onClick: vi.fn() },
        { label: "high", selected: true, onClick: vi.fn() },
      ],
    });

    const meta = parent.querySelector<HTMLElement>(".codex-panel__composer-meta");
    const statusItems = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-status-visual > span"));
    const fields = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-field"));
    const contextDots = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-context-dot"));
    const modeIcons = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-icon"));
    const statusSummary = parent.querySelector<HTMLElement>(".codex-panel__composer-meta-summary");
    const statusVisual = parent.querySelector<HTMLElement>(".codex-panel__composer-meta-status-visual");
    expect(meta?.getAttribute("aria-hidden")).toBeNull();
    expect(statusSummary?.textContent).toBe("Context 42%, plan on, auto-review off, fast on, model gpt-5.5, reasoning effort high");
    expect(statusVisual?.getAttribute("aria-hidden")).toBe("true");
    expect(statusVisual?.textContent).toBe("|⣿⣶⣀⣀42%|gpt-5.5|high");
    expect(statusItems.map((item) => item.className)).toEqual([
      "codex-panel__composer-meta-modes",
      "codex-panel__composer-meta-separator",
      "codex-panel__composer-meta-context",
      "codex-panel__composer-meta-field codex-panel__composer-meta-field--model",
      "codex-panel__composer-meta-field codex-panel__composer-meta-field--effort",
    ]);
    expect(fields.map((field) => field.textContent)).toEqual(["|gpt-5.5", "|high"]);
    expect(parent.querySelector(".codex-panel__composer-meta-status")?.getAttribute("aria-hidden")).toBeNull();
    expect(parent.querySelector(".codex-panel__composer-meta-context")?.textContent).toBe("⣿⣶⣀⣀42%");
    expect(contextDots.map((dot) => dot.textContent)).toEqual(["⣿", "⣶", "⣀", "⣀"]);
    expect(contextDots.map((dot) => dot.classList.contains("is-placeholder"))).toEqual([false, false, true, true]);
    expect(parent.querySelector(".codex-panel__composer-meta-model")?.textContent).toBe("gpt-5.5");
    expect(parent.querySelector(".codex-panel__composer-meta-effort")?.textContent).toBe("high");
    expect(modeIcons.map((icon) => icon.dataset["icon"])).toEqual(["list-todo", "shield", "zap"]);
    expect(modeIcons.map((icon) => icon.classList.contains("is-active"))).toEqual([true, false, true]);
    expect(modeIcons.map((icon) => icon.tagName)).toEqual(["SPAN", "SPAN", "SPAN"]);
    expect(modeIcons.map((icon) => icon.getAttribute("role"))).toEqual([null, null, null]);
    expect(modeIcons.map((icon) => icon.getAttribute("tabindex"))).toEqual([null, null, null]);
    expect(modeIcons.map((icon) => icon.getAttribute("aria-label"))).toEqual([null, null, null]);
    expect(modeIcons.every((icon) => icon.classList.contains("codex-panel__composer-meta-trigger"))).toBe(true);
    expect(modeIcons.every((icon) => !icon.className.includes("clickable-icon"))).toBe(true);
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-model")?.tagName).toBe("SPAN");
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-effort")?.tagName).toBe("SPAN");
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-model")?.getAttribute("role")).toBeNull();
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-meta-effort")?.getAttribute("tabindex")).toBeNull();
    expect(parent.querySelector(".codex-panel__composer-action.codex-panel__send")).not.toBeNull();
    expect(parent.querySelector(".codex-panel__new-chat")).toBeNull();
  });

  it("toggles composer runtime controls and opens separate lightweight pickers", async () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const selectModel = vi.fn();
    const selectEffort = vi.fn();

    mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, callbacks, {
      fatal: null,
      context: {
        cells: [
          { text: "⣿", placeholder: false },
          { text: "⣶", placeholder: false },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: "42%",
      },
      statusSummary: "Context 42%, plan on, auto-review off, fast on, model gpt-5.5, reasoning effort high",
      model: "gpt-5.5",
      effort: "high",
      planActive: true,
      autoReviewActive: false,
      fastActive: true,
      modelChoices: [
        { label: "gpt-5.5", selected: true, onClick: vi.fn() },
        { label: "gpt-5.4", onClick: selectModel },
      ],
      effortChoices: [
        { label: "medium", onClick: selectEffort },
        { label: "high", selected: true, onClick: vi.fn() },
      ],
    });

    const [planButton, reviewButton, fastButton] = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-icon"));
    planButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    reviewButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    fastButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(callbacks.onTogglePlan).toHaveBeenCalledOnce();
    expect(callbacks.onToggleAutoReview).toHaveBeenCalledOnce();
    expect(callbacks.onToggleFast).toHaveBeenCalledOnce();

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-model")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover--model")?.textContent).toBe("gpt-5.5gpt-5.4");
    });
    const metaOptions = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-option"));
    expect(metaOptions.map((option) => option.getAttribute("role"))).toEqual([null, null]);
    expect(metaOptions.map((option) => option.getAttribute("tabindex"))).toEqual([null, null]);
    expect(metaOptions.map((option) => option.getAttribute("aria-selected"))).toEqual([null, null]);
    expect(metaOptions.every((option) => !option.classList.contains("is-selected"))).toBe(true);
    expect(metaOptions.every((option) => !option.classList.contains("codex-panel-ui__nav-item"))).toBe(true);
    expect(metaOptions.every((option) => !option.classList.contains("codex-panel__toolbar-panel-item"))).toBe(true);

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-effort")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover--model")).toBeNull();
      expect(parent.querySelector(".codex-panel__composer-meta-popover--effort")?.textContent).toBe("mediumhigh");
    });

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-option")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectEffort).toHaveBeenCalledOnce();
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover")).toBeNull();
    });

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-model")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover--model")).not.toBeNull();
    });
    parent
      .querySelectorAll<HTMLElement>(".codex-panel__composer-meta-option")[1]
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectModel).toHaveBeenCalledOnce();
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover")).toBeNull();
    });

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-model")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover--model")).not.toBeNull();
    });
    document.dispatchEvent(new Event("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover")).toBeNull();
    });
  });

  it("hides composer meta fields only after measured overflow", async () => {
    const parent = document.createElement("div");

    mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, composerCallbacks(), {
      fatal: null,
      context: {
        cells: [
          { text: "⣿", placeholder: false },
          { text: "⣶", placeholder: false },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: "42%",
      },
      statusSummary: "Context 42%, plan on, auto-review off, fast on, model gpt-5.5, reasoning effort high",
      model: "gpt-5.5",
      effort: "high",
      planActive: true,
      autoReviewActive: false,
      fastActive: true,
    });

    const status = parent.querySelector<HTMLElement>(".codex-panel__composer-meta-status");
    if (!status) throw new Error("Expected composer meta status to render.");
    Object.defineProperty(status, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(status, "scrollWidth", {
      configurable: true,
      get: () => (status.classList.contains("is-model-hidden") ? 80 : status.classList.contains("is-effort-hidden") ? 120 : 140),
    });

    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });

    await waitForAsyncWork(() => {
      expect(status.classList.contains("is-effort-hidden")).toBe(true);
      expect(status.classList.contains("is-model-hidden")).toBe(true);
    });
  });

  it("replaces composer meta with fatal status text", () => {
    const parent = document.createElement("div");

    mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, composerCallbacks(), {
      fatal: "Codex app-server disconnected",
      context: {
        cells: [
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: "--%",
      },
      statusSummary: "Codex app-server disconnected",
      model: "",
      effort: null,
      planActive: false,
      autoReviewActive: false,
      fastActive: false,
    });

    expect(parent.querySelector(".codex-panel__composer-meta-fatal")?.textContent).toBe("Codex app-server disconnected");
    expect(parent.querySelector(".codex-panel__composer-meta-context")).toBeNull();
    expect(parent.querySelector(".codex-panel__composer-action.codex-panel__send")).not.toBeNull();
  });

  it("renders composer suggestions inside the composer root", () => {
    const parent = document.createElement("div");
    const onSuggestionInsert = vi.fn();
    const { composer } = mountComposerShellNode(
      parent,
      "view",
      "",
      false,
      false,
      "Ask Codex to work on this task...",
      [{ display: "/help", detail: "Show help", replacement: "/help", start: 0 }],
      0,
      {
        onInput: vi.fn(),
        onUpdateSuggestions: vi.fn(),
        onKeydown: vi.fn(),
        onSendOrInterrupt: vi.fn(),
        onHeightChange: vi.fn(),
        onSuggestionHover: vi.fn(),
        onSuggestionInsert,
      },
    );

    const suggestions = parent.querySelector<HTMLElement>(".codex-panel__composer-suggestions");
    if (!suggestions) throw new Error("Expected composer suggestions to render.");
    expect(suggestions.getAttribute("role")).toBe("listbox");
    expect(composer.getAttribute("aria-expanded")).toBe("true");
    expect(composer.getAttribute("aria-activedescendant")).toBe("view-composer-suggestion-0");
    suggestions
      .querySelector<HTMLElement>(".codex-panel__composer-suggestion")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onSuggestionInsert).toHaveBeenCalled();
  });

  it("clears composer suggestion accessibility state on rerender", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShellNode(
      parent,
      "view",
      "",
      false,
      false,
      "Ask Codex to work on this task...",
      [{ display: "/help", detail: "Show help", replacement: "/help", start: 0 }],
      0,
      callbacks,
    );

    mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, callbacks);

    const suggestions = parent.querySelector<HTMLElement>(".codex-panel__composer-suggestions");
    expect(composer.getAttribute("aria-expanded")).toBe("false");
    expect(composer.hasAttribute("aria-activedescendant")).toBe(false);
    expect(suggestions?.hidden).toBe(true);
  });

  it("reports composer draft changes from the controlled input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, callbacks);

    changeInputValue(composer, "Draft text");

    expect(callbacks.onInput).toHaveBeenCalledWith("Draft text");
  });

  it("syncs composer autogrow when the controlled input changes height", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    let scrollHeight = 56;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });
    try {
      const { composer } = mountComposerShellNode(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, callbacks);

      scrollHeight = 120;
      changeInputValue(composer, "line one\nline two");

      expect(composer.style.height).toBe("120px");
      expect(composer.style.overflowY).toBe("hidden");
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", descriptor);
      } else {
        Reflect.deleteProperty(HTMLTextAreaElement.prototype, "scrollHeight");
      }
    }
  });

  it("scrolls the selected composer suggestion fully into view below the viewport", () => {
    const { container, option } = composerSuggestionScrollFixture({
      clientHeight: 100,
      optionHeight: 32,
      optionTop: 92,
      scrollTop: 0,
    });

    scrollComposerSuggestionIntoView(container, option);

    expect(container.scrollTop).toBe(24);
  });

  it("scrolls the selected composer suggestion fully into view above the viewport", () => {
    const { container, option } = composerSuggestionScrollFixture({
      clientHeight: 100,
      optionHeight: 32,
      optionTop: 48,
      scrollTop: 64,
    });

    scrollComposerSuggestionIntoView(container, option);

    expect(container.scrollTop).toBe(48);
  });

  it("keeps composer suggestion scroll position when the selected item is already visible", () => {
    const { container, option } = composerSuggestionScrollFixture({
      clientHeight: 100,
      optionHeight: 32,
      optionTop: 72,
      scrollTop: 48,
    });

    scrollComposerSuggestionIntoView(container, option);

    expect(container.scrollTop).toBe(48);
  });

  it("uses the composer action for interrupt only when a running turn has no steering text", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShellNode(parent, "view", "", true, true, "Ask Codex to work on this task...", [], 0, callbacks);
    let sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(composer.getAttribute("placeholder")).toBe("Add steering message...");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(true);
    expect(sendButton?.classList.contains("is-steer")).toBe(false);
    expect(sendButton?.dataset["icon"]).toBe("square");

    mountComposerShellNode(parent, "view", "adjust course", true, true, "Ask Codex to work on this task...", [], 0, callbacks);
    sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(sendButton?.getAttribute("aria-label")).toBe("Steer");
    expect(composer.getAttribute("placeholder")).toBe("Add steering message...");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(false);
    expect(sendButton?.classList.contains("is-steer")).toBe(true);
    expect(sendButton?.dataset["icon"]).toBe("corner-down-right");
  });

  it("honors the smaller viewport branch of the composer max-height CSS", () => {
    const composer = document.createElement("textarea");
    const getComputedStyleMock = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      minHeight: "76px",
      maxHeight: "min(208px, 40vh)",
      boxSizing: "border-box",
      width: "240px",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);
    Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      get: () => 280,
      configurable: true,
    });

    try {
      syncComposerHeight(composer);
    } finally {
      getComputedStyleMock.mockRestore();
      if (descriptor) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", descriptor);
      } else {
        Reflect.deleteProperty(HTMLTextAreaElement.prototype, "scrollHeight");
      }
    }

    expect(composer.style.height).toBe("160px");
    expect(composer.style.overflowY).toBe("auto");
  });
});
