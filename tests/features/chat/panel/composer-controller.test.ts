// @vitest-environment jsdom

import { h } from "preact";
import { describe, expect, it, vi } from "vitest";
import type { SkillMetadata } from "../../../../src/domain/catalog/metadata";
import type { ComposerAttachment, ComposerAttachmentHandler } from "../../../../src/features/chat/application/composer/attachments";
import type {
  ComposerContextReferenceProvider,
  ComposerContextReferences,
} from "../../../../src/features/chat/application/composer/context-references";
import type { NoteCandidateProvider } from "../../../../src/features/chat/application/composer/note-context";
import type { ChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { ChatComposerController, type ChatComposerRenderActions } from "../../../../src/features/chat/panel/composer-controller";
import type { ChatPanelComposerShellState } from "../../../../src/features/chat/panel/shell-state";
import { ComposerShell } from "../../../../src/features/chat/ui/composer";
import { renderUiRoot, unmountUiRoot } from "../../../../src/shared/ui/ui-root.dom";
import { installObsidianDomShims } from "../../../support/dom";
import { composerShellStateFromChatState } from "../support/shell-state";

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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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

  it("saves pasted images, inserts an Obsidian embed, and sends a local image attachment", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const attachmentHandler: ComposerAttachmentHandler = {
      saveFiles: vi.fn().mockResolvedValue([
        {
          kind: "image",
          name: "diagram",
          path: "Codex Attachments/diagram.png",
          marker: "![[Codex Attachments/diagram.png]]",
        },
      ]),
    };
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      contextReferenceProvider: contextProvider(),
      attachmentHandler,
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
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    await flushComposerAttachment();

    expect(attachmentHandler.saveFiles).toHaveBeenCalledOnce();
    expect(composer(parent).value).toBe("![[Codex Attachments/diagram.png]]");
    expect(controller.preparedInput(composer(parent).value).input).toEqual([
      { type: "text", text: "![[Codex Attachments/diagram.png]]" },
      { type: "mention", name: "diagram", path: "Codex Attachments/diagram.png" },
      { type: "localImage", path: "Codex Attachments/diagram.png" },
    ]);
  });

  it("preserves pasted image attachments while slash commands clear the draft", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const attachmentHandler: ComposerAttachmentHandler = {
      saveFiles: vi.fn().mockResolvedValue([
        {
          kind: "image",
          name: "diagram",
          path: "Codex Attachments/diagram.png",
          marker: "![[Codex Attachments/diagram.png]]",
        },
      ]),
    };
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      contextReferenceProvider: contextProvider(),
      attachmentHandler,
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
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    await flushComposerAttachment();
    const marker = composer(parent).value;

    await controller.withPreservedComposerReferences(async () => {
      controller.setDraft("", { clearSuggestions: true });
      expect(controller.preparedInput(`Inspect ${marker}`).input).toEqual([
        { type: "text", text: `Inspect ${marker}` },
        { type: "mention", name: "diagram", path: "Codex Attachments/diagram.png" },
        { type: "localImage", path: "Codex Attachments/diagram.png" },
      ]);
    });
  });

  it("accepts protected file dragovers before dropped files are readable", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      contextReferenceProvider: contextProvider(),
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
    const dataTransfer = {
      files: [],
      items: [{ kind: "file", getAsFile: vi.fn(() => null) }],
      types: ["Files"],
      dropEffect: "none",
    };
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });

    renderComposerController(parent, controller, stateStore);
    composer(parent).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("waits for pending attachment saves before submitting", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const attachment: ComposerAttachment = {
      kind: "image",
      name: "diagram",
      path: "Codex Attachments/diagram.png",
      marker: "![[Codex Attachments/diagram.png]]",
    };
    const saveResolver: { current?: (attachments: ComposerAttachment[]) => void } = {};
    const attachmentHandler: ComposerAttachmentHandler = {
      saveFiles: vi.fn(
        () =>
          new Promise<ComposerAttachment[]>((resolve) => {
            saveResolver.current = resolve;
          }),
      ),
    };
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore, { submit });
    });
    const submit = vi.fn();
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      contextReferenceProvider: contextProvider(),
      attachmentHandler,
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
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));

    expect(attachmentHandler.saveFiles).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();

    if (!saveResolver.current) throw new Error("Expected save resolver.");
    saveResolver.current([attachment]);
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("![[Codex Attachments/diagram.png]]");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("saves dropped non-image files, inserts a wikilink, and sends a file mention", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const attachmentHandler: ComposerAttachmentHandler = {
      saveFiles: vi.fn().mockResolvedValue([
        {
          kind: "file",
          name: "paper",
          path: "Codex Attachments/paper.pdf",
          marker: "[[Codex Attachments/paper.pdf]]",
        },
      ]),
    };
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      contextReferenceProvider: contextProvider(),
      attachmentHandler,
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
    composer(parent).dispatchEvent(transferEvent("drop", "dataTransfer", [new File(["pdf"], "paper.pdf", { type: "application/pdf" })]));
    await flushComposerAttachment();

    expect(attachmentHandler.saveFiles).toHaveBeenCalledOnce();
    expect(composer(parent).value).toBe("[[Codex Attachments/paper.pdf]]");
    expect(controller.preparedInput(composer(parent).value).input).toEqual([
      { type: "text", text: "[[Codex Attachments/paper.pdf]]" },
      { type: "mention", name: "paper", path: "Codex Attachments/paper.pdf" },
    ]);
  });

  it("freezes active note context when inserting the active-note suggestion", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    let references: ComposerContextReferences = {
      activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
      selection: null,
    };
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider({ resolveMention: () => null }),
      contextReferenceProvider: contextProvider(() => references),
      sourcePath: () => "Inbox.md",
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
    setTextAreaValue(composer(parent), "@active");
    composer(parent).setSelectionRange(7, 7);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    references = { activeNote: null, selection: null };
    const completedActiveNoteReference = composer(parent).value;

    expect(completedActiveNoteReference).toBe("[[Alpha]]");
    expect(controller.preparedInput(completedActiveNoteReference).input).toContainEqual({
      type: "mention",
      name: "Alpha",
      path: "notes/Alpha.md",
    });

    await controller.withPreservedComposerReferences(async () => {
      controller.setDraft("", { clearSuggestions: true });
      expect(controller.preparedInput(completedActiveNoteReference).input).toContainEqual({
        type: "mention",
        name: "Alpha",
        path: "notes/Alpha.md",
      });
    });
  });

  it("freezes selection context when inserting the selection suggestion", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    let references = {
      activeNote: null,
      selection: {
        name: "Alpha",
        path: "notes/Alpha.md",
        linktext: "notes/Alpha",
        range: { from: { line: 41, ch: 4 }, to: { line: 46, ch: 0 } },
        text: "initial selection",
      },
    };
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider({
        resolveMention: (target) => (target === "notes/Alpha" ? { name: "Alpha", path: "notes/Alpha.md" } : null),
      }),
      contextReferenceProvider: contextProvider(() => references),
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
    setTextAreaValue(composer(parent), "@sel");
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    references = {
      activeNote: null,
      selection: {
        name: "Beta",
        path: "notes/Beta.md",
        linktext: "notes/Beta",
        range: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } },
        text: "changed selection",
      },
    };

    const prepared = controller.preparedInput(composer(parent).value);
    const completedSelectionReference = composer(parent).value;

    expect(composer(parent).value).toBe("[[notes/Alpha]] (L42:C5-L47:C1)");
    expect(prepared.input).toContainEqual({
      type: "additionalContext",
      key: "codex_panel_obsidian_context",
      kind: "untrusted",
      value:
        "Referenced Obsidian selections for the current user input:\n- [[notes/Alpha]] (L42:C5-L47:C1) -> notes/Alpha.md L42:C5-L47:C1\n\n[[notes/Alpha]] (L42:C5-L47:C1):\ninitial selection",
    });

    await controller.withPreservedComposerReferences(async () => {
      controller.setDraft("", { clearSuggestions: true });
      expect(controller.preparedInput(completedSelectionReference).input).toContainEqual({
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value:
          "Referenced Obsidian selections for the current user input:\n- [[notes/Alpha]] (L42:C5-L47:C1) -> notes/Alpha.md L42:C5-L47:C1\n\n[[notes/Alpha]] (L42:C5-L47:C1):\ninitial selection",
      });
    });
    expect(controller.preparedInput(completedSelectionReference).input).not.toContainEqual(
      expect.objectContaining({ key: "codex_panel_obsidian_context" }),
    );
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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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
      contextReferenceProvider: contextProvider(),
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

function noteProvider(overrides: Partial<NoteCandidateProvider> = {}): NoteCandidateProvider {
  return {
    candidates: () => [],
    resolveMention: () => null,
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

function transferEvent(type: "paste" | "drop", key: "clipboardData" | "dataTransfer", files: readonly File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, key, {
    value: { files },
  });
  return event;
}

async function flushComposerAttachment(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as T;
}
