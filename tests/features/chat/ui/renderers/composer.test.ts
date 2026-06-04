// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { renderComposerShell, scrollComposerSuggestionIntoView, syncComposerHeight } from "../../../../../src/features/chat/ui/composer";
import { changeInputValue, composerSuggestionScrollFixture, installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

function composerCallbacks() {
  return {
    onInput: vi.fn(),
    onComposerResize: vi.fn(),
    onUpdateSuggestions: vi.fn(),
    onKeydown: vi.fn(),
    onSendOrInterrupt: vi.fn(),
    onSuggestionHover: vi.fn(),
    onSuggestionInsert: vi.fn(),
  };
}

describe("composer renderer decisions", () => {
  it("uses the provided composer placeholder for normal input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = renderComposerShell(
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

    renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on “Renamed thread”...", [], 0, callbacks);

    expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Renamed thread”...");
  });

  it("renders composer meta as non-interactive context and runtime text", () => {
    const parent = document.createElement("div");

    renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, composerCallbacks(), {
      fatal: null,
      context: "ctx ⣿⣶   42%",
      model: "gpt-5.5",
      effort: "high",
    });

    const meta = parent.querySelector<HTMLElement>(".codex-panel__composer-meta");
    expect(meta?.getAttribute("aria-hidden")).toBeNull();
    expect(meta?.textContent).toBe("ctx ⣿⣶   42%|gpt-5.5|high");
    expect(parent.querySelector(".codex-panel__composer-meta-status")?.getAttribute("aria-hidden")).toBe("true");
    expect(parent.querySelector(".codex-panel__composer-meta-context")?.textContent).toBe("ctx ⣿⣶   42%");
    expect(parent.querySelector(".codex-panel__composer-meta-model")?.textContent).toBe("gpt-5.5");
    expect(parent.querySelector(".codex-panel__composer-meta-effort")?.textContent).toBe("high");
    expect(parent.querySelector(".codex-panel__composer-action.codex-panel__send")).not.toBeNull();
    expect(parent.querySelector(".codex-panel__new-chat")).toBeNull();
  });

  it("replaces composer meta with fatal status text", () => {
    const parent = document.createElement("div");

    renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, composerCallbacks(), {
      fatal: "Codex app-server disconnected",
      context: "",
      model: "",
      effort: null,
    });

    expect(parent.querySelector(".codex-panel__composer-meta-fatal")?.textContent).toBe("Codex app-server disconnected");
    expect(parent.querySelector(".codex-panel__composer-meta-context")).toBeNull();
    expect(parent.querySelector(".codex-panel__composer-action.codex-panel__send")).not.toBeNull();
  });

  it("renders composer suggestions inside the composer root", () => {
    const parent = document.createElement("div");
    const onSuggestionInsert = vi.fn();
    const { composer } = renderComposerShell(
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
        onComposerResize: vi.fn(),
        onUpdateSuggestions: vi.fn(),
        onKeydown: vi.fn(),
        onSendOrInterrupt: vi.fn(),
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
    const { composer } = renderComposerShell(
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

    renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, callbacks);

    const suggestions = parent.querySelector<HTMLElement>(".codex-panel__composer-suggestions");
    expect(composer.getAttribute("aria-expanded")).toBe("false");
    expect(composer.hasAttribute("aria-activedescendant")).toBe(false);
    expect(suggestions?.hidden).toBe(true);
  });

  it("reports composer draft changes from the controlled input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, callbacks);

    changeInputValue(composer, "Draft text");

    expect(callbacks.onInput).toHaveBeenCalledWith("Draft text");
  });

  it("reports composer resize when autogrow changes the input height", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    let scrollHeight = 56;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });
    try {
      const { composer } = renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", [], 0, callbacks);
      callbacks.onComposerResize.mockClear();

      scrollHeight = 120;
      changeInputValue(composer, "line one\nline two");

      expect(callbacks.onComposerResize).toHaveBeenCalledOnce();
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
    const { composer } = renderComposerShell(parent, "view", "", true, true, "Ask Codex to work on this task...", [], 0, callbacks);
    let sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(composer.getAttribute("placeholder")).toBe("Add steering message...");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(true);
    expect(sendButton?.classList.contains("is-steer")).toBe(false);
    expect(sendButton?.dataset["icon"]).toBe("square");

    renderComposerShell(parent, "view", "adjust course", true, true, "Ask Codex to work on this task...", [], 0, callbacks);
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
    } as CSSStyleDeclaration);
    Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
    Object.defineProperty(composer, "scrollHeight", { value: 280, configurable: true });

    try {
      syncComposerHeight(composer);
    } finally {
      getComputedStyleMock.mockRestore();
    }

    expect(composer.style.height).toBe("160px");
    expect(composer.style.overflowY).toBe("auto");
  });
});
