// @vitest-environment jsdom

import { h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillMetadata } from "../../../../../src/domain/runtime/catalog";
import type {
  ComposerAttachment,
  ComposerAttachmentHandler,
  ComposerAttachmentSaveResult,
} from "../../../../../src/features/chat/application/composer/attachments";
import type { SelectionContextReference } from "../../../../../src/features/chat/application/composer/context-references";
import type { ComposerInputSnapshot } from "../../../../../src/features/chat/application/composer/input-snapshot";
import { prepareComposerInput } from "../../../../../src/features/chat/application/composer/prepared-input";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { ChatComposerController } from "../../../../../src/features/chat/host/composer/controller";
import { selectChatPanelComposer } from "../../../../../src/features/chat/host/composer/view-projection";
import { createVaultComposerAttachmentHandler } from "../../../../../src/features/chat/host/obsidian/composer-attachments.obsidian";
import { useChatSelector } from "../../../../../src/features/chat/host/shell/state-selector";
import { ComposerShell } from "../../../../../src/features/chat/ui/composer/composer";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/preact-root.dom";
import { deferred } from "../../../../support/async";
import { installObsidianDomShims } from "../../../../support/dom";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import {
  attachmentFixture,
  attachmentSaveResult,
  composerInputOptions,
  contextProvider,
  noteProvider,
  readingReference,
  sharedResourcesFixture,
} from "../../support/composer-input-fixture";
import { chatComposerSharedValuesFixture } from "../../support/shared-display-values";
import { chatStateFixture } from "../../support/state";
import { pendingWebSubmissionFixture } from "../../support/web-submission";

installObsidianDomShims();

const emptySharedResources = chatComposerSharedValuesFixture();

type ChatComposerRenderActions = Parameters<ChatComposerController["renderState"]>[1];

const controllers = new Set<ChatComposerController>();
const renderedComposerParents = new Set<HTMLElement>();
const composerControllerTestCleanups: (() => void)[] = [];

afterEach(() => {
  while (composerControllerTestCleanups.length > 0) composerControllerTestCleanups.pop()?.();
  for (const parent of renderedComposerParents) unmountUiRoot(parent);
  renderedComposerParents.clear();
  for (const controller of controllers) disposeComposerController(controller);
  vi.restoreAllMocks();
});

function createComposerController(options: ComposerControllerOptions): ChatComposerController {
  const controller = new ChatComposerController(options);
  controllers.add(controller);
  return controller;
}

function disposeComposerController(controller: ChatComposerController): void {
  controllers.delete(controller);
  controller.dispose();
}

function renderComposerController(
  parent: HTMLElement,
  controller: ChatComposerController,
  stateStore: ChatStateStore,
  actions: ChatComposerRenderActions = { submit: vi.fn() },
): void {
  renderedComposerParents.add(parent);
  renderUiRoot(
    parent,
    h(ComposerShell, controller.renderState(selectChatPanelComposer(stateStore.getState(), emptySharedResources), actions)),
  );
}

function trackComposerControllerTestCleanup(cleanup: () => void): void {
  composerControllerTestCleanups.push(cleanup);
}

function resumeComposerThread(stateStore: ChatStateStore, threadId: string, created = false): void {
  stateStore.dispatch({
    ...threadActivationFixture(panelThreadFixture({ id: threadId })),
    type: created ? "active-thread/created" : "active-thread/resumed",
  });
}

type ComposerControllerOptions = ConstructorParameters<typeof ChatComposerController>[0];

function composerControllerOptions(
  stateStore: ChatStateStore,
  overrides: Partial<ComposerControllerOptions> = {},
): ComposerControllerOptions {
  return {
    ...composerInputOptions({ stateStore }),
    viewId: "view",
    referenceActiveNoteOnSend: () => false,
    sendShortcut: () => "enter",
    scrollThreadFromComposerEdges: () => false,
    threadScrollFromComposer: vi.fn(),
    runtimeActions: composerRuntimeActions(),
    togglePlan: vi.fn(),
    toggleAutoReview: vi.fn(),
    toggleFast: vi.fn(),
    canFocus: () => true,
    ...overrides,
    stateStore,
  };
}

function composerControllerFixture(
  options: { stateStore?: ChatStateStore; controller?: Partial<ComposerControllerOptions>; renderActions?: ChatComposerRenderActions } = {},
): {
  controller: ChatComposerController;
  parent: HTMLElement;
  renderShell: () => void;
  stateStore: ChatStateStore;
  prepareInput: (text: string, snapshot?: ComposerInputSnapshot) => ReturnType<typeof prepareComposerInput>;
} {
  const stateStore = options.stateStore ?? createChatStateStore();
  const parent = document.createElement("div");
  const controllerOptions = composerControllerOptions(stateStore, options.controller);
  const controller = createComposerController(controllerOptions);
  const renderShell = vi.fn(() => renderComposerController(parent, controller, stateStore, options.renderActions));
  trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));
  return {
    controller,
    parent,
    renderShell,
    stateStore,
    prepareInput: (text, snapshot = controller.input.captureInputSnapshot()) =>
      prepareComposerInput(text, snapshot, (target, sourcePath) =>
        controllerOptions.noteCandidateProvider.resolveFileReference(target, sourcePath),
      ),
  };
}

describe("ChatComposerController", () => {
  it("rejects stale input callbacks during fork return and accepts input again afterwards", () => {
    const saveFiles = vi.fn(async () => attachmentSaveResult([]));
    const { controller, stateStore, renderShell } = composerControllerFixture({ controller: { attachmentHandler: { saveFiles } } });
    stateStore.dispatch({
      type: "panel/fork-draft-applied",
      preparation: {
        draft: { kind: "persistent", sourceThreadId: "source", boundary: { kind: "through-turn", turnId: "turn" } },
        runtime: stateStore.getState().runtime,
        display: { items: [], turnDiffs: new Map() },
      },
    });
    controller.input.setDraft("/mo");
    renderShell();
    const submit = vi.fn();
    const { callbacks } = controller.renderState(selectChatPanelComposer(stateStore.getState(), emptySharedResources), { submit });
    const revision = stateStore.getState().panelTargetRevision;
    stateStore.dispatch({ type: "panel/fork-operation-set", revision, operation: "cancelling" });
    const before = stateStore.getState().composer;
    callbacks.onInput("changed");
    callbacks.onUpdateSuggestions();
    callbacks.onSuggestionInsert({ display: "model", detail: "", replacement: "/model", start: 0 });
    callbacks.onKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
    const transfer = { files: [new File(["image"], "image.png", { type: "image/png" })], items: [] } as unknown as DataTransfer;
    callbacks.onPaste({ clipboardData: transfer, preventDefault: vi.fn() } as unknown as ClipboardEvent);
    callbacks.onDrop({ dataTransfer: transfer, preventDefault: vi.fn() } as unknown as DragEvent);
    expect(stateStore.getState().composer).toEqual(before);
    expect(saveFiles).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    stateStore.dispatch({ type: "panel/fork-operation-set", revision });
    callbacks.onInput("changed");
    expect(stateStore.getState().composer.draft).toBe("changed");
    disposeComposerController(controller);
  });

  it.each([
    { canAcceptDirectInput: true, draft: "", action: "Interrupt", placeholder: "Steer the current turn..." },
    { canAcceptDirectInput: true, draft: "unsent draft", action: "Steer", placeholder: "Steer the current turn..." },
    { canAcceptDirectInput: false, draft: "unsent draft", action: "Interrupt", placeholder: "This thread cannot accept messages." },
  ])(
    "keeps button and keyboard $action available with direct input=$canAcceptDirectInput and draft=$draft",
    ({ canAcceptDirectInput, draft, action, placeholder }) => {
      const stateStore = createChatStateStore(chatStateFixture({ activeThread: { id: "thread", canAcceptDirectInput } }));
      stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
      const submit = vi.fn();
      const { controller, parent, renderShell } = composerControllerFixture({ stateStore, renderActions: { submit } });
      controller.input.setDraft(draft);
      renderShell();
      const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
      expect(composer(parent).readOnly).toBe(!canAcceptDirectInput);
      expect(composer(parent).getAttribute("placeholder")).toBe(placeholder);
      expect(sendButton?.getAttribute("aria-label")).toBe(action);
      expect(sendButton?.disabled).toBe(false);
      sendButton?.click();
      expect(submit).toHaveBeenCalledOnce();
      submit.mockClear();
      parent.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(submit).toHaveBeenCalledOnce();
      disposeComposerController(controller);
    },
  );

  it.each([
    { name: "plain Enter", shortcut: "enter", key: "Enter", sends: true },
    { name: "Shift+Enter", shortcut: "enter", key: "Enter", shiftKey: true, sends: false },
    { name: "Meta+Enter in Enter mode", shortcut: "enter", key: "Enter", metaKey: true, sends: false },
    { name: "composing Enter", shortcut: "enter", key: "Enter", isComposing: true, sends: false },
    { name: "another key", shortcut: "enter", key: "a", sends: false },
    { name: "Alt+Enter", shortcut: "enter", key: "Enter", altKey: true, sends: false },
    { name: "Meta+Enter", shortcut: "mod-enter", key: "Enter", metaKey: true, sends: true },
    { name: "Ctrl+Enter", shortcut: "mod-enter", key: "Enter", ctrlKey: true, sends: true },
    { name: "plain Enter in modifier mode", shortcut: "mod-enter", key: "Enter", sends: false },
    { name: "Shift+Meta+Enter", shortcut: "mod-enter", key: "Enter", shiftKey: true, metaKey: true, sends: false },
  ] as const)("submits from the textarea for $name only when configured", ({ name: _name, shortcut, sends, ...event }) => {
    const submit = vi.fn();
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: { sendShortcut: () => shortcut },
      renderActions: { submit },
    });
    controller.input.setDraft("Message");
    renderShell();

    const keydown = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...event });
    parent.querySelector("textarea")?.dispatchEvent(keydown);

    expect(submit).toHaveBeenCalledTimes(sends ? 1 : 0);
    expect(keydown.defaultPrevented).toBe(sends);
    disposeComposerController(controller);
  });

  it("focuses only while its panel is foreground unless workspace publication forces it", () => {
    let foreground = false;
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: { canFocus: () => foreground },
    });
    document.body.append(parent);
    trackComposerControllerTestCleanup(() => parent.remove());
    renderShell();
    const composer = parent.querySelector("textarea");
    if (!(composer instanceof HTMLTextAreaElement)) throw new Error("Expected composer textarea.");

    controller.focusComposer();
    expect(document.activeElement).not.toBe(composer);
    controller.input.setDraft("restored", { focus: true });
    expect(document.activeElement).not.toBe(composer);

    controller.focusComposer({ force: true });
    expect(document.activeElement).toBe(composer);
    composer.blur();
    foreground = true;
    controller.focusComposer();
    expect(document.activeElement).toBe(composer);
  });

  it("locks composer input while keeping button and keyboard cancellation of a web import available", () => {
    const submit = vi.fn();
    const { controller, stateStore, parent, renderShell } = composerControllerFixture({ renderActions: { submit } });
    stateStore.dispatch({ type: "web-submission/pending", submission: pendingWebSubmissionFixture(null, { phase: "cancellable" }) });

    renderShell();
    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(composer(parent).readOnly).toBe(true);
    expect(sendButton?.getAttribute("aria-label")).toBe("Cancel web import");
    expect(sendButton?.disabled).toBe(false);
    sendButton?.click();
    expect(submit).toHaveBeenCalledOnce();
    submit.mockClear();
    parent.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submit).toHaveBeenCalledOnce();
    disposeComposerController(controller);
  });

  it("locks composer input without offering cancel after a web submission commits", () => {
    const submit = vi.fn();
    const { stateStore, parent, renderShell } = composerControllerFixture({ renderActions: { submit } });
    stateStore.dispatch({ type: "web-submission/pending", submission: pendingWebSubmissionFixture(null, { phase: "committed" }) });

    renderShell();
    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(composer(parent).readOnly).toBe(true);
    expect(sendButton?.getAttribute("aria-label")).toBe("Send");
    expect(sendButton?.disabled).toBe(true);
    sendButton?.click();
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps a disconnected subagent composer read-only without slash suggestions", () => {
    const stateStore = createChatStateStore(
      chatStateFixture({
        activeThread: {
          id: "child-thread",
          provenance: {
            kind: "subagent",
            parentThreadId: "parent-thread",
          },
        },
      }),
    );
    stateStore.dispatch({ type: "connection/scoped-cleared" });
    const { controller, parent } = composerControllerFixture({ stateStore });

    renderComposerController(parent, controller, stateStore);
    const props = controller.renderState(selectChatPanelComposer(stateStore.getState(), emptySharedResources), { submit: vi.fn() });
    setTextAreaValue(composer(parent), "/");
    composer(parent).setSelectionRange(1, 1);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    expect(props.submissionDisabled).toBe(false);
    expect(props.directInputDisabled).toBe(true);
    expect(stateStore.getState().composer.suggestions).toEqual([]);
  });

  it("updates Obsidian tag suggestions when the input changes", () => {
    const { controller, parent, stateStore } = composerControllerFixture({
      controller: {
        noteCandidateProvider: noteProvider({ tags: () => ["project/codex"] }),
      },
    });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "#pro");
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    expect(stateStore.getState().composer.suggestions[0]).toMatchObject({
      display: "#project/codex",
      replacement: "#project/codex",
    });
    expect(parent.querySelector(".codex-panel__composer-suggestion")?.textContent).toContain("#project/codex");
  });

  it.each([
    { key: "Tab", cursor: "[[Beta Note".length },
    { key: "Enter", cursor: "[[Beta Note]]".length },
  ])("focuses the composer and restores the $key wikilink cursor after rendering", async ({ key, cursor }) => {
    const stateStore = createChatStateStore();
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
    const parent = document.createElement("div");
    const controller = createComposerController(
      composerControllerOptions(stateStore, { noteCandidateProvider: noteProvider({ candidates: () => notes }) }),
    );
    const selector = (state: ReturnType<ChatStateStore["getState"]>) => selectChatPanelComposer(state, emptySharedResources);
    const actions = { submit: vi.fn() };
    // biome-ignore lint/correctness/noComponentHookFactories: The test creates this component once, outside any render.
    function ObservedComposer() {
      const model = useChatSelector(stateStore, selector);
      return h(ComposerShell, controller.renderState(model, actions));
    }
    document.body.append(parent);
    renderedComposerParents.add(parent);
    trackComposerControllerTestCleanup(() => parent.remove());

    await act(() => renderUiRoot(parent, h(ObservedComposer, {})));
    await act(() => {
      setTextAreaValue(composer(parent), "[[bet");
      composer(parent).setSelectionRange(5, 5);
      composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
      expect(document.activeElement).toBe(composer(parent));
    });
    await act(() => {
      composer(parent).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }));
    });

    expect(composer(parent).value).toBe("[[Beta Note]]");
    expect(composer(parent).selectionStart).toBe(cursor);
    expect(composer(parent).selectionEnd).toBe(cursor);
  });

  it("accepts protected file dragovers before dropped files are readable", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const controller = createComposerController(composerControllerOptions(stateStore, {}));
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

  it.each([
    { outcome: "saved", draft: "", expected: "![[Codex Attachments/diagram.png]]" },
    { outcome: "failed", draft: "Keep this draft", expected: "Keep this draft" },
  ])("keeps input editable and requires a new Send after an attachment is $outcome", async ({ outcome, draft, expected }) => {
    const saved = deferred<ComposerAttachmentSaveResult>();
    const saveFiles = vi.fn(() => saved.promise);
    const submit = vi.fn();
    const onAttachmentError = vi.fn();
    const { controller, parent, renderShell, stateStore } = composerControllerFixture({
      controller: { attachmentHandler: { saveFiles }, onAttachmentError },
      renderActions: { submit },
    });
    controller.input.setDraft(draft);
    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__send")?.disabled).toBe(true);
    expect(composer(parent).readOnly).toBe(false);
    expect(composer(parent).value).toContain("Saving attachment…");
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    expect(saveFiles).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();

    if (outcome === "saved") saved.resolve(attachmentSaveResult([attachmentFixture("diagram")]));
    else saved.reject(new Error("Attachment save failed."));
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    expect(composer(parent).value).toBe(expected);
    expect(onAttachmentError.mock.calls).toEqual(outcome === "failed" ? [["Attachment save failed."]] : []);
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__send")?.disabled).toBe(false);
    expect(submit).not.toHaveBeenCalled();

    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("keeps successfully saved files in the draft when another dropped file cannot be written", async () => {
    const paths = new Set<string>(["Files"]);
    const vault = {
      getAbstractFileByPath: (path: string) => (paths.has(path) ? {} : null),
      createFolder: async (path: string) => {
        paths.add(path);
      },
      createBinary: async (path: string) => {
        if (path === "Files/broken.txt") throw new Error("Write failed");
        paths.add(path);
      },
    };
    const onAttachmentError = vi.fn();
    const { controller, parent, renderShell, stateStore } = composerControllerFixture({
      controller: {
        attachmentHandler: createVaultComposerAttachmentHandler({ app: { vault } as never, attachmentFolder: () => "Files" }),
        onAttachmentError,
      },
    });
    renderShell();
    controller.input.setDraft("Read these");
    composer(parent).dispatchEvent(
      transferEvent("drop", "dataTransfer", [new File(["first"], "first.txt"), new File(["broken"], "broken.txt")]),
    );
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    expect(composer(parent).value).toBe("Read these\n[[Files/first.txt]]");
    expect(controller.input.captureInputSnapshot().attachments.map((attachment) => attachment.path)).toEqual(["Files/first.txt"]);
    expect(onAttachmentError).toHaveBeenCalledWith("Could not save attachments:\nbroken.txt: Write failed");
    expect(paths.has("Files/first.txt")).toBe(true);
  });

  it.each([
    { outcome: "failed", editLabel: false, expected: "keep selected text" },
    { outcome: "failed", editLabel: true, expected: "keep selected text" },
    { outcome: "saved", editLabel: true, expected: "keep \n![[Codex Attachments/diagram.png]]\n text" },
  ])("preserves the moved caret after an attachment is $outcome (edited label: $editLabel)", async ({ outcome, editLabel, expected }) => {
    const saved = deferred<ComposerAttachmentSaveResult>();
    const { controller, parent, renderShell, stateStore } = composerControllerFixture({
      controller: { attachmentHandler: { saveFiles: () => saved.promise } },
    });
    controller.input.setDraft("keep selected text");
    renderShell();
    composer(parent).setSelectionRange(5, 13);
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    if (editLabel) controller.input.setDraft(composer(parent).value.replace("Saving attachment…", "Uploading…"));
    composer(parent).setSelectionRange(0, 0);

    if (outcome === "saved") saved.resolve(attachmentSaveResult([attachmentFixture("diagram")]));
    else saved.reject(new Error("Attachment save failed."));
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    expect(composer(parent).value).toBe(expected);
    expect(composer(parent).selectionStart).toBe(0);
    expect(composer(parent).selectionEnd).toBe(0);
  });

  it("allows an interrupt after a pending attachment placeholder is removed", () => {
    const saved = deferred<ComposerAttachment[]>();
    const submit = vi.fn();
    const stateStore = createChatStateStore();
    resumeComposerThread(stateStore, "thread");
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    const { controller, parent, renderShell } = composerControllerFixture({
      stateStore,
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise.then(attachmentSaveResult)) },
      },
      renderActions: { submit },
    });
    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    controller.input.setDraft("");

    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(sendButton?.disabled).toBe(false);
    sendButton?.click();

    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not submit or apply saved attachments after disposal", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const saved = deferred<ComposerAttachmentSaveResult>();
    const attachmentHandler: ComposerAttachmentHandler = {
      saveFiles: vi.fn(() => saved.promise),
    };
    const submit = vi.fn();
    const controller = createComposerController(
      composerControllerOptions(stateStore, {
        attachmentHandler,
      }),
    );

    renderComposerController(parent, controller, stateStore, { submit });
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    disposeComposerController(controller);
    saved.resolve(attachmentSaveResult([attachmentFixture("diagram")]));
    await saved.promise;

    expect(submit).not.toHaveBeenCalled();
    expect(stateStore.getState().composer.draft).toBe("");
    expect(controller.input.captureInputSnapshot().attachments).toEqual([]);
  });

  it("saves dropped files, restores focus immediately, and preserves later focus on completion", async () => {
    const stateStore = createChatStateStore();
    const attachmentHandler: ComposerAttachmentHandler = {
      saveFiles: vi.fn().mockResolvedValue(
        attachmentSaveResult([
          {
            kind: "file",
            name: "paper",
            path: "Codex Attachments/paper.pdf",
            marker: "[[Codex Attachments/paper.pdf]]",
          },
        ]),
      ),
    };
    const { prepareInput, parent, renderShell } = composerControllerFixture({
      stateStore,
      controller: {
        attachmentHandler,
      },
    });

    const otherControl = document.createElement("button");
    document.body.append(parent, otherControl);
    trackComposerControllerTestCleanup(() => {
      parent.remove();
      otherControl.remove();
    });
    renderShell();
    composer(parent).dispatchEvent(transferEvent("drop", "dataTransfer", [new File(["pdf"], "paper.pdf", { type: "application/pdf" })]));
    expect(document.activeElement).toBe(composer(parent));
    otherControl.focus();
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    expect(document.activeElement).toBe(otherControl);
    expect(attachmentHandler.saveFiles).toHaveBeenCalledOnce();
    expect(composer(parent).value).toBe("[[Codex Attachments/paper.pdf]]");
    expect(prepareInput(composer(parent).value).input).toEqual([
      { type: "text", text: "[[Codex Attachments/paper.pdf]]" },
      { type: "fileReference", name: "paper", path: "Codex Attachments/paper.pdf" },
    ]);
  });

  it.each([
    ["Enter", "expired"],
    ["click", "expired"],
    ["Enter", "replaced"],
    ["click", "replaced"],
  ])("rejects a stale Reading suggestion on %s when %s", (activation, change) => {
    let selection: SelectionContextReference | null = readingReference("old", "old excerpt");
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: { contextReferenceProvider: contextProvider(() => ({ activeNote: null, selection })) },
    });
    renderShell();
    setTextAreaValue(composer(parent), "@sel");
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    const staleOption = selectedSuggestion(parent);
    selection = change === "expired" ? null : readingReference("new", "new excerpt");
    if (activation === "click") staleOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    else composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    expect(composer(parent).value).toBe("@sel");
    expect(controller.input.captureInputSnapshot().selectionSnapshots).toEqual([]);
  });

  it("navigates suggestions and keeps them dismissed until the input changes", () => {
    const stateStore = createChatStateStore();
    const { parent, renderShell } = composerControllerFixture({ stateStore, controller: {} });

    renderShell();
    setTextAreaValue(composer(parent), "/");
    composer(parent).setSelectionRange(1, 1);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    expect(stateStore.getState().composer.draft).toBe("/");
    const firstSelected = selectedSuggestion(parent);
    expect(firstSelected.textContent).toContain("/clear");

    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    expect(stateStore.getState().composer.suggestSelected).toBe(1);
    expect(selectedSuggestion(parent).textContent).not.toBe(firstSelected.textContent);

    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true }));
    expect(stateStore.getState().composer.suggestSelected).toBe(0);
    expect(selectedSuggestion(parent).textContent).toBe(firstSelected.textContent);

    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    const dismissed = stateStore.getState().composer.suggestionsDismissedSignature;
    expect(dismissed).not.toBeNull();
    composer(parent).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Escape" }));
    expect(stateStore.getState().composer.suggestions).toEqual([]);
    expect(stateStore.getState().composer.suggestionsDismissedSignature).toBe(dismissed);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    expect(stateStore.getState().composer.suggestions).toEqual([]);
    setTextAreaValue(composer(parent), "/st");
    composer(parent).setSelectionRange(3, 3);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    expect(stateStore.getState().composer.suggestions.length).toBeGreaterThan(0);
    expect(stateStore.getState().composer.suggestionsDismissedSignature).toBeNull();
  });

  it("keeps suggestions closed after inserting at a cursor before later trigger text", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "composer/draft-set", draft: "/pla then $ob" });
    const { parent, renderShell } = composerControllerFixture({
      stateStore,
      controller: {
        sharedResources: sharedResourcesFixture({ skills: [skill("obsidian-search")] }),
      },
    });

    renderShell();
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));

    const planSuggestion = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__composer-suggestion"));
    expect(planSuggestion.textContent).toContain("/plan");

    planSuggestion.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(composer(parent).value).toBe("/plan then $ob");
    expect(composer(parent).selectionStart).toBe("/plan".length);
    expect(stateStore.getState().composer.suggestions).toEqual([]);
    expect(parent.querySelector<HTMLElement>(".codex-panel__composer-suggestions")?.hidden).toBe(true);
    expect(composer(parent).hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("routes page scrolling while leaving disabled line-edge scrolling to the textarea", () => {
    const threadScrollFromComposer = vi.fn();
    const { controller, parent, stateStore } = composerControllerFixture({ controller: { threadScrollFromComposer } });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "first\nsecond");
    composer(parent).setSelectionRange("first\nsecond".length, "first\nsecond".length);

    const line = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "n", ctrlKey: true });
    composer(parent).dispatchEvent(line);
    const page = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "PageDown" });
    composer(parent).dispatchEvent(page);

    expect(line.defaultPrevented).toBe(false);
    expect(page.defaultPrevented).toBe(true);
    expect(threadScrollFromComposer).toHaveBeenCalledExactlyOnceWith({ kind: "scroll-by", direction: 1, amount: "page" });
  });

  it("clears the Preact-owned textarea ref when the composer unmounts", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "composer/draft-set", draft: "state draft" });
    const { controller, parent } = composerControllerFixture({ stateStore });

    renderComposerController(parent, controller, stateStore);
    const mountedComposer = composer(parent);
    setTextAreaValue(mountedComposer, "stale dom draft");
    const focus = vi.spyOn(mountedComposer, "focus");

    unmountUiRoot(parent);
    controller.input.setDraft("state draft", { focus: true });

    expect(controller.input.draft).toBe("state draft");
    expect(focus).not.toHaveBeenCalled();
  });
});

function skill(name: string): SkillMetadata {
  return {
    name,
    description: `${name} description`,
    path: `/vault/skills/${name}/SKILL.md`,
    scope: "repo",
    pluginId: null,
    enabled: true,
  };
}

function composerRuntimeActions() {
  return {
    requestModel: vi.fn(),
    requestReasoningEffort: vi.fn(),
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

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as T;
}
