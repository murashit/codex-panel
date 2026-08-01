// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it, vi } from "vitest";
import type { ComposerMetaViewModel } from "../../../../src/features/chat/ui/composer";
import { type ComposerCallbacks, ComposerShell } from "../../../../src/features/chat/ui/composer";
import { scrollComposerSuggestionIntoView, syncComposerHeight } from "../../../../src/features/chat/ui/composer.dom";
import { renderUiRoot } from "../../../../src/shared/dom/preact-root.dom";
import { waitForAsyncWork } from "../../../support/async";
import { changeInputValue, composerSuggestionScrollFixture, installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();

type ComposerSuggestion = Parameters<ComposerCallbacks["onSuggestionInsert"]>[0];

function mountComposerShell(
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
  webSubmissionPending = false,
  webSubmissionCancellable = webSubmissionPending,
  sendDisabled = false,
  runtimeControlsDisabled = false,
  directInputDisabled = false,
): { composer: HTMLTextAreaElement } {
  const elements: { composer: HTMLTextAreaElement | null } = { composer: null };
  renderUiRoot(
    parent,
    h(ComposerShell, {
      viewId,
      draft,
      busy,
      canInterrupt,
      submissionDisabled: webSubmissionPending,
      directInputDisabled,
      runtimeControlsDisabled,
      sendDisabled,
      webSubmissionCancellable,
      normalPlaceholder,
      suggestions,
      selectedSuggestionIndex,
      pendingSelection: null,
      onPendingSelectionApplied: vi.fn(),
      callbacks,
      meta:
        meta ??
        ({
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
          fastAvailable: true,
          fastActive: false,
          modelChoices: [],
          effortChoices: [],
        } satisfies ComposerMetaViewModel),
      onComposer: (composer) => {
        if (composer) elements.composer = composer;
      },
    }),
  );
  if (!elements.composer) throw new Error("Expected composer shell elements to mount.");
  return { composer: elements.composer };
}

function composerCallbacks() {
  return {
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
  };
}

describe("ComposerShell decisions", () => {
  it("renders composer meta as interactive context and runtime text without changing normal text", () => {
    const parent = document.createElement("div");

    mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, composerCallbacks(), {
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
      fastAvailable: true,
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

    const contextDots = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-context-dot"));
    const modeIcons = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-icon"));
    const statusSummary = parent.querySelector<HTMLElement>(".codex-panel__composer-meta-summary");
    const statusVisual = parent.querySelector<HTMLElement>(".codex-panel__composer-meta-status-visual");
    expect(statusSummary?.textContent).toBe("Context 42%, plan on, auto-review off, fast on, model gpt-5.5, reasoning effort high");
    expect(statusVisual?.getAttribute("aria-hidden")).toBe("true");
    expect(statusVisual?.textContent).toBe("|⣿⣶⣀⣀42%|gpt-5.5|high");
    expect(parent.querySelector(".codex-panel__composer-meta-context")?.textContent).toBe("⣿⣶⣀⣀42%");
    expect(contextDots.map((dot) => dot.textContent)).toEqual(["⣿", "⣶", "⣀", "⣀"]);
    expect(contextDots.map((dot) => dot.classList.contains("is-placeholder"))).toEqual([false, false, true, true]);
    expect(parent.querySelector(".codex-panel__composer-meta-model")?.textContent).toBe("gpt-5.5");
    expect(parent.querySelector(".codex-panel__composer-meta-effort")?.textContent).toBe("high");
    expect(modeIcons.map((icon) => icon.dataset["icon"])).toEqual(["list-todo", "shield", "zap"]);
    expect(modeIcons.map((icon) => icon.classList.contains("is-active"))).toEqual([true, false, true]);
    expect(modeIcons.map((icon) => icon.getAttribute("aria-hidden"))).toEqual(["true", "true", "true"]);
    expect(parent.querySelector(".codex-panel__composer-action.codex-panel__send")).not.toBeNull();
  });

  it("disables runtime controls without disabling side-chat composition", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    mountComposerShell(
      parent,
      "view",
      "Continue the side chat",
      false,
      false,
      "Ask in side chat...",
      [],
      0,
      callbacks,
      {
        fatal: null,
        context: { cells: [], percent: "0%" },
        statusSummary: "Context 0%, plan off, auto-review off, fast off, model gpt-5.5, reasoning effort high",
        model: "gpt-5.5",
        effort: "high",
        planActive: false,
        autoReviewActive: false,
        fastAvailable: true,
        fastActive: false,
        modelChoices: [{ label: "gpt-5.5", onClick: vi.fn() }],
        effortChoices: [{ label: "high", onClick: vi.fn() }],
      },
      false,
      false,
      false,
      true,
    );

    expect(parent.querySelector<HTMLTextAreaElement>(".codex-panel__composer-input")?.readOnly).toBe(false);
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__send")?.disabled).toBe(false);
    const runtimeTriggers = [...parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-trigger")];
    expect(runtimeTriggers.length).toBeGreaterThan(0);
    expect(runtimeTriggers.every((trigger) => trigger.classList.contains("is-disabled"))).toBe(true);
    runtimeTriggers[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(callbacks.onTogglePlan).not.toHaveBeenCalled();
    expect(parent.querySelector(".codex-panel__composer-meta-popover")).toBeNull();
  });

  it("toggles composer runtime controls and opens separate lightweight pickers", async () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const selectModel = vi.fn();
    const selectEffort = vi.fn();

    mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, callbacks, {
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
      fastAvailable: true,
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
      expect(parent.querySelector('[data-codex-panel-composer-meta-kind="model"]')?.textContent).toBe("gpt-5.5gpt-5.4");
    });
    const metaOptions = Array.from(parent.querySelectorAll<HTMLElement>(".codex-panel__composer-meta-option"));
    expect(metaOptions.map((option) => option.textContent)).toEqual(["gpt-5.5", "gpt-5.4"]);

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-effort")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector('[data-codex-panel-composer-meta-kind="model"]')).toBeNull();
      expect(parent.querySelector('[data-codex-panel-composer-meta-kind="effort"]')?.textContent).toBe("mediumhigh");
    });

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-option")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectEffort).toHaveBeenCalledOnce();
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover")).toBeNull();
    });

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-model")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector('[data-codex-panel-composer-meta-kind="model"]')).not.toBeNull();
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
      expect(parent.querySelector('[data-codex-panel-composer-meta-kind="model"]')).not.toBeNull();
    });
    document.dispatchEvent(new Event("mousedown", { bubbles: true }));
    await waitForAsyncWork(() => {
      expect(parent.querySelector(".codex-panel__composer-meta-popover")).toBeNull();
    });
  });

  it("keeps Fast visible but ignores interaction when the selected model does not support it", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, callbacks, {
      fatal: null,
      context: { cells: [], percent: "0%" },
      statusSummary: "Context 0%, plan off, auto-review off, fast off, model gpt-5.4-mini, reasoning effort medium",
      model: "gpt-5.4-mini",
      effort: "medium",
      planActive: false,
      autoReviewActive: false,
      fastAvailable: false,
      fastActive: false,
      modelChoices: [],
      effortChoices: [],
    });

    const fastButton = parent.querySelector<HTMLElement>('[data-icon="zap"]');
    expect(fastButton).not.toBeNull();
    expect(fastButton?.classList.contains("is-disabled")).toBe(true);
    fastButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(callbacks.onToggleFast).not.toHaveBeenCalled();
  });

  it("hides composer meta fields only after measured overflow", async () => {
    const parent = document.createElement("div");

    mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, composerCallbacks(), {
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
      fastAvailable: true,
      fastActive: true,
      modelChoices: [],
      effortChoices: [],
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

    mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, composerCallbacks(), {
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
      fastAvailable: false,
      fastActive: false,
      modelChoices: [],
      effortChoices: [],
    });

    expect(parent.querySelector(".codex-panel__composer-meta-fatal")?.textContent).toBe("Codex app-server disconnected");
    expect(parent.querySelector(".codex-panel__composer-meta-context")).toBeNull();
    expect(parent.querySelector(".codex-panel__composer-action.codex-panel__send")).not.toBeNull();
  });

  it("renders composer suggestions inside the composer root", () => {
    const parent = document.createElement("div");
    const onSuggestionInsert = vi.fn();
    const { composer } = mountComposerShell(
      parent,
      "view",
      "",
      false,
      false,
      "Ask Codex...",
      [{ display: "/help", detail: "Show help", replacement: "/help", start: 0 }],
      0,
      {
        ...composerCallbacks(),
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
    const { composer } = mountComposerShell(
      parent,
      "view",
      "",
      false,
      false,
      "Ask Codex...",
      [{ display: "/help", detail: "Show help", replacement: "/help", start: 0 }],
      0,
      callbacks,
    );

    mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, callbacks);

    const suggestions = parent.querySelector<HTMLElement>(".codex-panel__composer-suggestions");
    expect(composer.getAttribute("aria-expanded")).toBe("false");
    expect(composer.hasAttribute("aria-activedescendant")).toBe(false);
    expect(suggestions?.hidden).toBe(true);
  });

  it("reports composer draft changes from the controlled input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, callbacks);

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
      const { composer } = mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, callbacks);

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

  it("shrinks composer autogrow when the controlled draft clears after send", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const onComposer = vi.fn();
    let scrollHeight = 120;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });

    try {
      renderUiRoot(
        parent,
        h(ComposerShell, {
          viewId: "view",
          draft: "line one\nline two",
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
          callbacks,
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
            fastAvailable: true,
            fastActive: false,
            modelChoices: [],
            effortChoices: [],
          },
          onComposer,
        }),
      );
      const composer = parent.querySelector<HTMLTextAreaElement>(".codex-panel__composer-input");
      if (!composer) throw new Error("Expected composer shell elements to mount.");
      expect(composer.style.height).toBe("120px");

      scrollHeight = 56;
      renderUiRoot(
        parent,
        h(ComposerShell, {
          viewId: "view",
          draft: "",
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
          callbacks,
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
            fastAvailable: true,
            fastActive: false,
            modelChoices: [],
            effortChoices: [],
          },
          onComposer,
        }),
      );

      expect(composer.style.height).toBe("56px");
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
    const { composer } = mountComposerShell(parent, "view", "", true, true, "Ask Codex...", [], 0, callbacks);
    let sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(composer.getAttribute("placeholder")).toBe("Steer the current turn...");
    expect(composer.getAttribute("aria-label")).toBeNull();
    expect(sendButton?.classList.contains("is-interrupt")).toBe(true);
    expect(sendButton?.classList.contains("is-steer")).toBe(false);
    expect(sendButton?.dataset["icon"]).toBe("square");

    mountComposerShell(parent, "view", "adjust course", true, true, "Ask Codex...", [], 0, callbacks);
    sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(sendButton?.getAttribute("aria-label")).toBe("Steer");
    expect(composer.getAttribute("placeholder")).toBe("Steer the current turn...");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(false);
    expect(sendButton?.classList.contains("is-steer")).toBe(true);
    expect(sendButton?.dataset["icon"]).toBe("corner-down-right");
  });

  it("keeps interrupt enabled while a send-only attachment barrier is active", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    mountComposerShell(parent, "view", "", true, true, "Ask Codex...", [], 0, callbacks, undefined, false, false, true);
    let sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(sendButton?.disabled).toBe(false);

    mountComposerShell(parent, "view", "steer later", true, true, "Ask Codex...", [], 0, callbacks, undefined, false, false, true);
    sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(sendButton?.getAttribute("aria-label")).toBe("Steer");
    expect(sendButton?.disabled).toBe(true);
  });

  it("keeps interrupt available while direct input is disabled", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShell(
      parent,
      "view",
      "unsent draft",
      true,
      true,
      "This thread cannot accept messages.",
      [],
      0,
      callbacks,
      undefined,
      false,
      false,
      false,
      false,
      true,
    );
    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(composer.readOnly).toBe(true);
    expect(composer.getAttribute("placeholder")).toBe("This thread cannot accept messages.");
    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(sendButton?.disabled).toBe(false);
  });

  it("renders an enabled cancel control while a web import locks composer input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, callbacks, undefined, true);
    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(composer.readOnly).toBe(true);
    expect(sendButton?.getAttribute("aria-label")).toBe("Cancel web import");
    expect(sendButton?.disabled).toBe(false);
    sendButton?.click();
    expect(callbacks.onSendOrInterrupt).toHaveBeenCalledOnce();
  });

  it("keeps composer locked without offering cancel after a web import commits", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = mountComposerShell(parent, "view", "", false, false, "Ask Codex...", [], 0, callbacks, undefined, true, false);
    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(composer.readOnly).toBe(true);
    expect(sendButton?.getAttribute("aria-label")).toBe("Send");
    expect(sendButton?.disabled).toBe(true);
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
