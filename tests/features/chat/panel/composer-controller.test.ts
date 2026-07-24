// @vitest-environment jsdom

import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillMetadata } from "../../../../src/domain/catalog/metadata";
import type { ComposerAttachment, ComposerAttachmentHandler } from "../../../../src/features/chat/application/composer/attachments";
import type {
  ComposerContextReferenceProvider,
  ComposerContextReferences,
} from "../../../../src/features/chat/application/composer/context-references";
import type { NoteCandidateProvider } from "../../../../src/features/chat/application/composer/note-context";
import { createLocalIdSource } from "../../../../src/features/chat/application/local-id-source";
import type { ChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { threadStreamItems } from "../../../../src/features/chat/application/state/thread-stream";
import { submitComposer } from "../../../../src/features/chat/application/turns/composer-submit-command";
import { pendingWebSubmissionItem } from "../../../../src/features/chat/application/turns/web-submission";
import type { ThreadStreamItem } from "../../../../src/features/chat/domain/thread-stream/items";
import { ChatComposerController } from "../../../../src/features/chat/panel/composer-controller";
import type { ChatPanelComposerModel } from "../../../../src/features/chat/panel/shell-selectors";
import { ComposerShell } from "../../../../src/features/chat/ui/composer";
import { renderUiRoot, unmountUiRoot } from "../../../../src/shared/dom/preact-root.dom";
import { deferred } from "../../../support/async";
import { installObsidianDomShims } from "../../../support/dom";
import { composerModelFromChatState } from "../support/shell-selectors";
import { chatStateFixture, chatStateWith } from "../support/state";

installObsidianDomShims();

type ChatComposerRenderActions = Parameters<ChatComposerController["renderState"]>[1];

const renderedComposerParents = new Set<HTMLElement>();
const composerControllerTestCleanups: (() => void)[] = [];

afterEach(() => {
  while (composerControllerTestCleanups.length > 0) composerControllerTestCleanups.pop()?.();
  for (const parent of renderedComposerParents) unmountUiRoot(parent);
  renderedComposerParents.clear();
});

function renderComposerController(
  parent: HTMLElement,
  controller: ChatComposerController,
  stateStore: ChatStateStore,
  actions: ChatComposerRenderActions = { submit: vi.fn() },
): void {
  renderedComposerParents.add(parent);
  renderUiRoot(parent, h(ComposerShell, controller.renderState(composerModelFromChatState(stateStore.getState()), actions)));
}

function trackComposerControllerTestCleanup(cleanup: () => void): void {
  composerControllerTestCleanups.push(cleanup);
}

function resumeComposerThread(stateStore: ChatStateStore, threadId: string): void {
  stateStore.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: {
      id: threadId,
      preview: "",
      name: null,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      provenance: { kind: "interactive" },
    },
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

type ComposerControllerOptions = ConstructorParameters<typeof ChatComposerController>[0];

function composerControllerFixture(
  options: { stateStore?: ChatStateStore; controller?: Partial<ComposerControllerOptions>; renderActions?: ChatComposerRenderActions } = {},
): {
  controller: ChatComposerController;
  parent: HTMLElement;
  renderShell: () => void;
  stateStore: ChatStateStore;
} {
  const stateStore = options.stateStore ?? createChatStateStore();
  const parent = document.createElement("div");
  const controller = new ChatComposerController({
    noteCandidateProvider: noteProvider(),
    contextReferenceProvider: contextProvider(),
    sourcePath: () => "",
    viewId: "view",
    referenceActiveNoteOnSend: () => false,
    sendShortcut: () => "enter",
    scrollThreadFromComposerEdges: () => false,
    threadScrollFromComposer: vi.fn(),
    canInterrupt: (_state) => false,
    composerProjection: defaultComposerProjection,
    currentModelForSuggestions: () => null,
    togglePlan: vi.fn(),
    toggleAutoReview: vi.fn(),
    toggleFast: vi.fn(),
    onHeightChange: vi.fn(),
    canFocus: () => true,
    ...options.controller,
    stateStore,
  });
  const renderShell = vi.fn(() => renderComposerController(parent, controller, stateStore, options.renderActions));
  trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));
  return { controller, parent, renderShell, stateStore };
}

describe("ChatComposerController", () => {
  it("keeps edits typed after a claimed submission and restores both drafts on failure", () => {
    const stateStore = createChatStateStore();
    resumeComposerThread(stateStore, "thread");
    const { controller } = composerControllerFixture({ stateStore });
    controller.setDraft("first message");

    const claim = controller.claimSubmission();
    expect(claim?.text).toBe("first message");
    expect(stateStore.getState().composer.draft).toBe("");

    controller.setDraft("next message");
    claim?.settle("failed");

    expect(stateStore.getState().composer.draft).toBe("first message\n\nnext message");
  });

  it("leaves the editable next draft untouched when a claimed submission is accepted", () => {
    const { controller, stateStore } = composerControllerFixture();
    controller.setDraft("first message");
    const claim = controller.claimSubmission();

    controller.setDraft("next message");
    claim?.settle("accepted");

    expect(stateStore.getState().composer.draft).toBe("next message");
  });

  it("places a slash command replacement before a draft typed while the command was running", () => {
    const { controller, stateStore } = composerControllerFixture();
    controller.setDraft("/goal");
    const claim = controller.claimSubmission();

    controller.setDraft("next message");
    claim?.settle("accepted", "/goal set Current objective");

    expect(stateStore.getState().composer.draft).toBe("/goal set Current objective\n\nnext message");
  });

  it("releases a stale claim without restoring it into the new panel target", () => {
    const stateStore = createChatStateStore();
    resumeComposerThread(stateStore, "first");
    const { controller } = composerControllerFixture({ stateStore });
    controller.setDraft("/web https://example.com");
    const staleClaim = controller.claimSubmission();

    resumeComposerThread(stateStore, "second");
    controller.setDraft("second-thread draft");

    expect(controller.isSubmissionPreparing()).toBe(false);
    staleClaim?.settle("failed");
    expect(stateStore.getState().composer.draft).toBe("second-thread draft");
    expect(controller.claimSubmission()).not.toBeNull();
  });

  it("keeps an adopted target-changing slash command committed without restoring it over the next draft", async () => {
    const stateStore = createChatStateStore();
    const { controller } = composerControllerFixture({ stateStore });
    controller.setDraft("/clear");
    const execute = vi.fn(async (_command, _args, _snapshot, submission) => {
      controller.setDraft("next message");
      submission.adoptPanelTarget();
      resumeComposerThread(stateStore, "started");
      return undefined;
    });

    await submitComposer({
      stateStore,
      localItemIds: createLocalIdSource(),
      composer: controller,
      slashCommandExecutor: { execute },
      turnSubmissionCommand: { sendTurnText: vi.fn().mockResolvedValue(true) },
      connection: { ensureConnected: vi.fn().mockResolvedValue(true) },
      turnPort: { interruptTurn: vi.fn().mockResolvedValue({}) },
      status: { setStatus: vi.fn(), addSystemMessage: vi.fn() },
      scroll: { showLatest: vi.fn() },
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(stateStore.getState().composer.draft).toBe("next message");
    expect(controller.isSubmissionPreparing()).toBe(false);
  });

  it("places a rollback replacement before the next draft across its adopted target", () => {
    const stateStore = createChatStateStore();
    resumeComposerThread(stateStore, "source");
    const { controller } = composerControllerFixture({ stateStore });
    controller.setDraft("/rollback");
    const claim = controller.claimSubmission();
    controller.setDraft("next message");
    claim?.adoptPanelTarget("rolled back prompt");

    resumeComposerThread(stateStore, "rolled-back");

    expect(stateStore.getState().composer.draft).toBe("rolled back prompt\n\nnext message");
    claim?.settle("accepted");
    expect(stateStore.getState().composer.draft).toBe("rolled back prompt\n\nnext message");
  });

  it("hands claimed draft and context to a replacement runtime", () => {
    const first = composerControllerFixture();
    const attachment = {
      kind: "image" as const,
      name: "diagram",
      path: "Codex Attachments/diagram.png",
      marker: "![[Codex Attachments/diagram.png]]",
    };
    const activeNote = { name: "Note", path: "Note.md", linktext: "Note" };
    const selection = {
      name: "Selection",
      path: "Selection.md",
      linktext: "Selection",
      range: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } },
      text: "text",
    };
    first.controller.restoreRuntimeSnapshot({
      draft: `/web https://example.com ${attachment.marker} [[Note]]`,
      attachments: [attachment],
      activeNoteSnapshots: [activeNote],
      selectionSnapshots: [selection],
      threadCommandTarget: null,
    });
    first.controller.claimSubmission();
    first.controller.setDraft("next draft");

    const snapshot = first.controller.runtimeSnapshot();
    const replacement = composerControllerFixture();
    replacement.controller.restoreRuntimeSnapshot(snapshot);
    const restoredInput = replacement.controller.captureInputSnapshot();

    expect(snapshot.draft).toBe(`/web https://example.com ${attachment.marker} [[Note]]\n\nnext draft`);
    expect(restoredInput.attachments).toEqual([attachment]);
    expect(restoredInput.activeNoteSnapshots).toEqual([activeNote]);
    expect(restoredInput.selectionSnapshots).toEqual([selection]);
  });

  it("does not hand an adopted submission back as a resendable draft", () => {
    const { controller } = composerControllerFixture();
    controller.setDraft("submitted message");
    const claim = controller.claimSubmission();
    controller.setDraft("later draft");
    claim?.markAdopted();

    const snapshot = controller.runtimeSnapshot();
    claim?.settle("failed");

    expect(snapshot.draft).toBe("later draft");
    expect(controller.isSubmissionPreparing()).toBe(false);
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
    controller.setDraft("restored", { focus: true });
    expect(document.activeElement).not.toBe(composer);

    controller.focusComposer({ force: true });
    expect(document.activeElement).toBe(composer);
    composer.blur();
    foreground = true;
    controller.focusComposer();
    expect(document.activeElement).toBe(composer);
  });

  it("locks composer input while exposing a pending web import to the send control", () => {
    const { controller, stateStore } = composerControllerFixture();
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        phase: "cancellable",
      },
    });

    const props = controller.renderState(composerModelFromChatState(stateStore.getState()), { submit: vi.fn() });

    expect(props.submissionDisabled).toBe(true);
    expect(props.webSubmissionCancellable).toBe(true);
  });

  it("locks composer input without offering cancel after a web submission commits", () => {
    const { controller, stateStore } = composerControllerFixture();
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        phase: "committed",
      },
    } as never);

    const props = controller.renderState(composerModelFromChatState(stateStore.getState()), { submit: vi.fn() });

    expect(props.submissionDisabled).toBe(true);
    expect(props.webSubmissionCancellable).toBe(false);
  });

  it("keeps a pending web submission after a turn that completes during the fetch", () => {
    const stateStore = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }));
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    const assistant: ThreadStreamItem = {
      id: "assistant",
      kind: "dialogue",
      dialogueKind: "assistantResponse",
      role: "assistant",
      text: "done",
      dialogueState: "completed",
      turnId: "turn",
    };
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        phase: "cancellable",
      },
    });
    stateStore.dispatch({ type: "turn/completed", turnId: "turn", status: "completed", items: [assistant] });

    expect(threadStreamItems(stateStore.getState().threadStream).map((item) => item.id)).toEqual(["assistant"]);
    expect(stateStore.getState().pendingSubmission?.id).toBe(pending.id);
  });

  it("derives composer placeholder and meta from the projection", () => {
    const projection = vi.fn((model: ChatPanelComposerModel) => ({
      placeholder: `Projected ${model.draft || "empty"}`,
      meta: defaultComposerProjection(model).meta,
    }));
    const { controller, stateStore } = composerControllerFixture({ controller: { composerProjection: projection } });

    const props = controller.renderState(composerModelFromChatState(stateStore.getState()), { submit: vi.fn() });

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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    controllerRef.current = controller;
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    setTextAreaValue(composer(parent), "/");
    composer(parent).setSelectionRange(1, 1);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    expect(stateStore.getState().composer.draft).toBe("/");
    expect(stateStore.getState().composer.suggestions.length).toBeGreaterThan(0);
    expect(parent.querySelector(".codex-panel__composer-suggestion")?.textContent).toContain("/");
  });

  it("captures completed thread identity across message edits and drops it when the title token changes", () => {
    const stateStore = createChatStateStore();
    const preview = `Long preview ${"x".repeat(120)}`;
    const completedTitle = `${preview.slice(0, 93)}...`;
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [
        {
          id: "target-thread",
          preview,
          name: null,
          archived: false,
          createdAt: 1,
          updatedAt: 1,
          provenance: { kind: "interactive" },
        },
      ],
    });
    const { controller, parent } = composerControllerFixture({ stateStore });
    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "/refer long");
    composer(parent).setSelectionRange(11, 11);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));

    expect(composer(parent).value).toBe(`/refer "${completedTitle}" `);
    expect(controller.captureInputSnapshot().threadCommandTarget).toEqual({
      command: "refer",
      threadId: "target-thread",
      title: completedTitle,
    });

    setTextAreaValue(composer(parent), `${composer(parent).value}summarize`);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    expect(controller.captureInputSnapshot().threadCommandTarget?.threadId).toBe("target-thread");

    setTextAreaValue(composer(parent), composer(parent).value.replace(completedTitle, "edited title"));
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    expect(controller.captureInputSnapshot().threadCommandTarget).toBeUndefined();
  });

  it.each([
    ["/f", "/fork", false],
    ["/f", "/fast", false],
    ["/b", "/btw", false],
    ["/r", "/rollback", false],
    ["/g", "/goal", false],
    ["/c", "/compact", true],
  ])("applies ephemeral-thread suggestion policy for %s -> %s", (draft, suggestion, available) => {
    const stateStore = createChatStateStore(
      chatStateFixture({
        activeThread: {
          id: "side-thread",
          lifetime: { kind: "ephemeral", sourceThreadId: "source-thread", sourceThreadTitle: "Source" },
        },
      }),
    );
    const { controller, parent } = composerControllerFixture({ stateStore });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), draft);
    composer(parent).setSelectionRange(draft.length, draft.length);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      stateStore
        .getState()
        .composer.suggestions.map((item) => item.replacement)
        .includes(suggestion),
    ).toBe(available);
  });

  it("keeps a disconnected subagent composer read-only without slash suggestions", () => {
    const stateStore = createChatStateStore(
      chatStateFixture({
        activeThread: {
          id: "child-thread",
          provenance: {
            kind: "subagent",
            subagentKind: "thread-spawn",
            parentThreadId: "parent-thread",
            sessionId: "session",
            depth: 1,
            agentNickname: "Scout",
            agentRole: "explorer",
          },
        },
      }),
    );
    stateStore.dispatch({ type: "connection/scoped-cleared" });
    const { controller, parent } = composerControllerFixture({ stateStore });

    renderComposerController(parent, controller, stateStore);
    const props = controller.renderState(composerModelFromChatState(stateStore.getState()), { submit: vi.fn() });
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

  it("does not read Obsidian tags for non-tag suggestions", () => {
    const tags = vi.fn(() => ["project/codex"]);
    const { controller, parent, stateStore } = composerControllerFixture({
      controller: {
        noteCandidateProvider: noteProvider({ tags }),
      },
    });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "/");
    composer(parent).setSelectionRange(1, 1);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));

    expect(stateStore.getState().composer.suggestions.length).toBeGreaterThan(0);
    expect(tags).not.toHaveBeenCalled();
  });

  it("inserts configured relative daily-note references as wikilinks", () => {
    const dailyNoteReferences = vi.fn(() => [
      {
        keyword: "today" as const,
        display: "Today",
        name: "2026-07-10",
        path: "Journal/2026-07-10.md",
        linktext: "Journal/2026-07-10",
      },
    ]);
    const { controller, parent, stateStore } = composerControllerFixture({
      controller: {
        noteCandidateProvider: noteProvider({ dailyNoteReferences }),
        sourcePath: () => "Inbox.md",
      },
    });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "@today");
    composer(parent).setSelectionRange(6, 6);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));

    expect(composer(parent).value).toBe("[[Journal/2026-07-10]]");
    expect(dailyNoteReferences).toHaveBeenCalledWith("Inbox.md");
  });

  it("keeps Tab wikilink insertion before closing brackets while Enter lands after them", () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
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
    let controller: ChatComposerController | null = null;
    const renderShell = vi.fn(() => {
      if (!controller) throw new Error("Expected controller.");
      renderComposerController(parent, controller, stateStore);
    });
    controller = new ChatComposerController({
      noteCandidateProvider: noteProvider({ candidates: () => notes }),
      contextReferenceProvider: contextProvider(),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    setTextAreaValue(composer(parent), "[[bet");
    composer(parent).setSelectionRange(5, 5);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    composer(parent).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Tab" }));

    expect(composer(parent).value).toBe("[[Beta Note]]");
    expect(composer(parent).selectionStart).toBe("[[Beta Note".length);

    setTextAreaValue(composer(parent), "[[bet");
    composer(parent).setSelectionRange(5, 5);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    composer(parent).dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));

    expect(composer(parent).value).toBe("[[Beta Note]]");
    expect(composer(parent).selectionStart).toBe("[[Beta Note]]".length);
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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    await flushComposerAttachment();

    expect(attachmentHandler.saveFiles).toHaveBeenCalledOnce();
    expect(composer(parent).value).toBe("![[Codex Attachments/diagram.png]]");
    expect(controller.preparedInput(composer(parent).value).input).toEqual([
      { type: "text", text: "![[Codex Attachments/diagram.png]]" },
      { type: "fileReference", name: "diagram", path: "Codex Attachments/diagram.png" },
      { type: "localImage", path: "Codex Attachments/diagram.png" },
    ]);
  });

  it("does not insert a saved attachment into a later thread or draft", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const stateStore = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread-first" } }));
    const { controller, parent, renderShell } = composerControllerFixture({
      stateStore,
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    renderShell();
    controller.setDraft("first draft");
    composer(parent).setSelectionRange(5, 5);
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "first.png", { type: "image/png" })]));

    stateStore.dispatch({ type: "active-thread/cleared" });
    controller.setDraft("later draft");
    composer(parent).setSelectionRange(2, 2);
    saved.resolve([attachmentFixture("first")]);
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("later draft");
    expect(controller.captureInputSnapshot().attachments).toEqual([]);
  });

  it("does not insert a saved attachment after leaving and returning to the same thread state", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const stateStore = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }));
    const { controller, parent, renderShell } = composerControllerFixture({
      stateStore,
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    renderShell();
    controller.setDraft("same draft");
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "first.png", { type: "image/png" })]));

    stateStore.dispatch({ type: "active-thread/cleared" });
    resumeComposerThread(stateStore, "thread");
    controller.setDraft("same draft");
    composer(parent).setSelectionRange(4, 4);
    saved.resolve([attachmentFixture("first")]);
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("same draft");
    expect(controller.captureInputSnapshot().attachments).toEqual([]);
  });

  it("keeps a pending attachment at its placeholder while the draft is edited", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    renderShell();
    controller.setDraft("before after");
    composer(parent).setSelectionRange(6, 6);
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "first.png", { type: "image/png" })]));

    setTextAreaValue(composer(parent), `edited ${composer(parent).value}`);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    saved.resolve([attachmentFixture("first")]);
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("edited before\n![[Codex Attachments/first.png]]\n after");
    expect(controller.captureInputSnapshot().attachments).toEqual([attachmentFixture("first")]);
  });

  it("inserts multiple transfers that began at the same draft anchor", async () => {
    const first = deferred<ComposerAttachment[]>();
    const second = deferred<ComposerAttachment[]>();
    let call = 0;
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: {
        attachmentHandler: {
          saveFiles: vi.fn(() => {
            call += 1;
            return call === 1 ? first.promise : second.promise;
          }),
        },
      },
    });
    renderShell();
    controller.setDraft("note");
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "first.png", { type: "image/png" })]));
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "second.png", { type: "image/png" })]));

    second.resolve([attachmentFixture("second")]);
    await flushComposerAttachment();
    first.resolve([attachmentFixture("first")]);
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("note\n![[Codex Attachments/first.png]]\n![[Codex Attachments/second.png]]");
    expect(controller.captureInputSnapshot().attachments.map((attachment) => attachment.name)).toEqual(["first", "second"]);
  });

  it("preserves pasted image attachments when connection exit restores a cancellable web draft", async () => {
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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    await flushComposerAttachment();
    const marker = composer(parent).value;
    const snapshot = controller.captureInputSnapshot();
    const originalDraft = `/web https://example.com Inspect ${marker}`;
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", `Inspect ${marker}`);
    if (!pending) throw new Error("Expected pending web submission");

    controller.setDraft(originalDraft);
    const claim = controller.claimSubmission();
    stateStore.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: null,
        phase: "cancellable",
      },
    });
    stateStore.dispatch({ type: "connection/scoped-cleared" });
    claim?.settle("failed");
    const restoredSnapshot = controller.captureInputSnapshot();

    expect(controller.draft).toBe(originalDraft);
    expect(controller.preparedInput(`Inspect ${marker}`, snapshot).input).toEqual([
      { type: "text", text: `Inspect ${marker}` },
      { type: "fileReference", name: "diagram", path: "Codex Attachments/diagram.png" },
      { type: "localImage", path: "Codex Attachments/diagram.png" },
    ]);
    expect(controller.preparedInput(`Inspect ${marker}`, restoredSnapshot).input).toEqual([
      { type: "text", text: `Inspect ${marker}` },
      { type: "fileReference", name: "diagram", path: "Codex Attachments/diagram.png" },
      { type: "localImage", path: "Codex Attachments/diagram.png" },
    ]);
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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
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

  it("keeps the composer editable but requires a new Send after attachment saves settle", async () => {
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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(sendButton?.disabled).toBe(true);
    expect(composer(parent).readOnly).toBe(false);
    expect(composer(parent).value).toContain("Saving attachment…");
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));

    expect(attachmentHandler.saveFiles).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();

    if (!saveResolver.current) throw new Error("Expected save resolver.");
    saveResolver.current([attachment]);
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("![[Codex Attachments/diagram.png]]");
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__send")?.disabled).toBe(false);
    expect(submit).not.toHaveBeenCalled();

    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("removes a failed attachment placeholder without submitting the draft", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const submit = vi.fn();
    const onAttachmentError = vi.fn();
    const { controller, parent, renderShell, stateStore } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
        onAttachmentError,
      },
      renderActions: { submit },
    });
    renderShell();
    controller.setDraft("Keep this draft");
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));

    saved.reject(new Error("Attachment save failed."));
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("Keep this draft");
    expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]);
    expect(onAttachmentError).toHaveBeenCalledWith("Attachment save failed.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("restores selected draft text and caret when attachment saving fails", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    controller.setDraft("keep selected text");
    renderShell();
    composer(parent).setSelectionRange(5, 13);
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    composer(parent).setSelectionRange(0, 0);

    saved.reject(new Error("Attachment save failed."));
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("keep selected text");
    expect(composer(parent).selectionStart).toBe(0);
    expect(composer(parent).selectionEnd).toBe(0);
  });

  it("settles an attachment after its placeholder label is edited", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    controller.setDraft("Keep this draft");
    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    controller.setDraft(composer(parent).value.replace("Saving attachment…", "Uploading…"));
    composer(parent).setSelectionRange(0, 0);

    saved.resolve([
      {
        kind: "image",
        name: "diagram",
        path: "Codex Attachments/diagram.png",
        marker: "![[Codex Attachments/diagram.png]]",
      },
    ]);
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("Keep this draft\n![[Codex Attachments/diagram.png]]");
    expect(composer(parent).value).not.toContain("codex-panel-pending-attachment:");
    expect(composer(parent).selectionStart).toBe(0);
  });

  it("removes an edited attachment placeholder when saving fails", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    controller.setDraft("Keep this draft");
    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    controller.setDraft(composer(parent).value.replace("Saving attachment…", "Uploading…"));

    saved.reject(new Error("Attachment save failed."));
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("Keep this draft");
    expect(composer(parent).value).not.toContain("codex-panel-pending-attachment:");
  });

  it("restores selected text without synthetic separators after the placeholder label is edited", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    controller.setDraft("keep selected text");
    renderShell();
    composer(parent).setSelectionRange(5, 13);
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    controller.setDraft(composer(parent).value.replace("Saving attachment…", "Uploading…"));
    composer(parent).setSelectionRange(0, 0);

    saved.reject(new Error("Attachment save failed."));
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("keep selected text");
    expect(composer(parent).selectionStart).toBe(0);
  });

  it("allows an interrupt after a pending attachment placeholder is removed", () => {
    const saved = deferred<ComposerAttachment[]>();
    const submit = vi.fn();
    const { controller, parent, renderShell } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
        canInterrupt: () => true,
      },
      renderActions: { submit },
    });
    renderShell();
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    controller.setDraft("");

    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(sendButton?.disabled).toBe(false);
    sendButton?.click();

    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not reinsert a saved attachment after the user removes its placeholder", async () => {
    const saved = deferred<ComposerAttachment[]>();
    const attachment: ComposerAttachment = {
      kind: "image",
      name: "diagram",
      path: "Codex Attachments/diagram.png",
      marker: "![[Codex Attachments/diagram.png]]",
    };
    const { controller, parent, renderShell, stateStore } = composerControllerFixture({
      controller: {
        attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      },
    });
    renderShell();
    controller.setDraft("Keep this draft");
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    controller.setDraft("Keep this edited draft");

    saved.resolve([attachment]);
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(composer(parent).value).toBe("Keep this edited draft");
    expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]);
  });

  it("does not submit or apply saved attachments after disposal", async () => {
    const stateStore = createChatStateStore();
    const parent = document.createElement("div");
    const saved = deferred<ComposerAttachment[]>();
    const attachmentHandler: ComposerAttachmentHandler = {
      saveFiles: vi.fn(() => saved.promise),
    };
    const submit = vi.fn();
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider(),
      contextReferenceProvider: contextProvider(),
      attachmentHandler,
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });

    renderComposerController(parent, controller, stateStore, { submit });
    composer(parent).dispatchEvent(transferEvent("paste", "clipboardData", [new File(["image"], "diagram.png", { type: "image/png" })]));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    controller.dispose();
    saved.resolve([
      {
        kind: "image",
        name: "diagram",
        path: "Codex Attachments/diagram.png",
        marker: "![[Codex Attachments/diagram.png]]",
      },
    ]);
    await flushComposerAttachment();
    await flushComposerAttachment();

    expect(submit).not.toHaveBeenCalled();
    expect(stateStore.getState().composer.draft).toBe("");
    expect(controller.captureInputSnapshot().attachments).toEqual([]);
  });

  it("saves dropped non-image files, inserts a wikilink, and sends a file reference", async () => {
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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    composer(parent).dispatchEvent(transferEvent("drop", "dataTransfer", [new File(["pdf"], "paper.pdf", { type: "application/pdf" })]));
    await flushComposerAttachment();

    expect(attachmentHandler.saveFiles).toHaveBeenCalledOnce();
    expect(composer(parent).value).toBe("[[Codex Attachments/paper.pdf]]");
    expect(controller.preparedInput(composer(parent).value).input).toEqual([
      { type: "text", text: "[[Codex Attachments/paper.pdf]]" },
      { type: "fileReference", name: "paper", path: "Codex Attachments/paper.pdf" },
    ]);
  });

  it("freezes active file context when inserting the active suggestion", async () => {
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
      noteCandidateProvider: noteProvider({ resolveFileReference: () => null }),
      contextReferenceProvider: contextProvider(() => references),
      sourcePath: () => "Inbox.md",
      stateStore,
      viewId: "view",
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    setTextAreaValue(composer(parent), "@active");
    composer(parent).setSelectionRange(7, 7);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    const completedActiveNoteReference = composer(parent).value;
    const snapshot = controller.captureInputSnapshot();
    references = { activeNote: null, selection: null };

    expect(completedActiveNoteReference).toBe("[[Alpha]]");
    expect(controller.preparedInput(completedActiveNoteReference).input).toContainEqual({
      type: "fileReference",
      name: "Alpha",
      path: "notes/Alpha.md",
    });

    controller.setDraft("", { clearSuggestions: true });
    expect(controller.preparedInput(completedActiveNoteReference, snapshot).input).toContainEqual({
      type: "fileReference",
      name: "Alpha",
      path: "notes/Alpha.md",
    });
  });

  it("uses the captured active file when slash commands prepare input asynchronously", () => {
    const stateStore = createChatStateStore();
    let references: ComposerContextReferences = {
      activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
      selection: null,
    };
    const controller = new ChatComposerController({
      noteCandidateProvider: noteProvider({ resolveFileReference: () => null }),
      contextReferenceProvider: contextProvider(() => references),
      sourcePath: () => "Inbox.md",
      stateStore,
      viewId: "view",
      referenceActiveNoteOnSend: () => true,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });

    const snapshot = controller.captureInputSnapshot();
    references = {
      activeNote: { name: "Beta", path: "notes/Beta.md", linktext: "Beta" },
      selection: null,
    };

    expect(controller.preparedInput("Rewrite intro", snapshot).input).toEqual([
      { type: "text", text: "Rewrite intro" },
      { type: "fileReference", name: "<active>", path: "notes/Alpha.md" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value: "Obsidian references for the current user input:\n- <active> -> notes/Alpha.md",
      },
    ]);
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
        resolveFileReference: (target) => (target === "notes/Alpha" ? { name: "Alpha", path: "notes/Alpha.md" } : null),
      }),
      contextReferenceProvider: contextProvider(() => references),
      sourcePath: () => "",
      stateStore,
      viewId: "view",
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

    renderShell();
    setTextAreaValue(composer(parent), "@sel");
    composer(parent).setSelectionRange(4, 4);
    composer(parent).dispatchEvent(new Event("input", { bubbles: true }));
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    const completedSelectionReference = composer(parent).value;
    const snapshot = controller.captureInputSnapshot();
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

    const prepared = controller.preparedInput(completedSelectionReference, snapshot);

    expect(composer(parent).value).toBe("[[notes/Alpha]] (L42:C5-L47:C1)");
    expect(prepared.input).toContainEqual({
      type: "additionalContext",
      key: "codex_panel_obsidian_context",
      kind: "untrusted",
      value:
        "Obsidian references for the current user input:\n- [[notes/Alpha]] (L42:C5-L47:C1) -> notes/Alpha.md (inline excerpt below)\n\nInline excerpts:\n[[notes/Alpha]] (L42:C5-L47:C1):\ninitial selection",
    });

    controller.setDraft("", { clearSuggestions: true });
    expect(controller.preparedInput(completedSelectionReference, snapshot).input).toContainEqual({
      type: "additionalContext",
      key: "codex_panel_obsidian_context",
      kind: "untrusted",
      value:
        "Obsidian references for the current user input:\n- [[notes/Alpha]] (L42:C5-L47:C1) -> notes/Alpha.md (inline excerpt below)\n\nInline excerpts:\n[[notes/Alpha]] (L42:C5-L47:C1):\ninitial selection",
    });
    expect(controller.preparedInput(completedSelectionReference).input).toContainEqual({
      type: "additionalContext",
      key: "codex_panel_obsidian_context",
      kind: "untrusted",
      value: "Obsidian references for the current user input:\n- [[notes/Alpha]] -> notes/Alpha.md",
    });
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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

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
      referenceActiveNoteOnSend: () => false,
      sendShortcut: () => "enter",
      scrollThreadFromComposerEdges: () => false,
      threadScrollFromComposer: vi.fn(),
      canInterrupt: (_state) => false,
      composerProjection: defaultComposerProjection,
      currentModelForSuggestions: () => null,
      togglePlan: vi.fn(),
      toggleAutoReview: vi.fn(),
      toggleFast: vi.fn(),
      canFocus: () => true,
      onHeightChange: vi.fn(),
    });
    trackComposerControllerTestCleanup(stateStore.subscribe(renderShell));

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
    const togglePlan = vi.fn();
    const { controller, parent, stateStore } = composerControllerFixture({ controller: { togglePlan } });

    renderComposerController(parent, controller, stateStore);

    parent.querySelector<HTMLElement>(".codex-panel__composer-meta-icon")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(togglePlan).toHaveBeenCalledOnce();
  });

  it("delegates submit events through render actions", () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({ type: "composer/draft-set", draft: "hello" });
    const submit = vi.fn();
    const { controller, parent } = composerControllerFixture({ stateStore });

    renderComposerController(parent, controller, stateStore, { submit });
    composer(parent).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));

    expect(submit).toHaveBeenCalledOnce();
  });

  it("scrolls by page from the composer even when line edge scrolling is disabled", () => {
    const threadScrollFromComposer = vi.fn();
    const { controller, parent, stateStore } = composerControllerFixture({ controller: { threadScrollFromComposer } });

    renderComposerController(parent, controller, stateStore);
    setTextAreaValue(composer(parent), "first\nsecond");
    composer(parent).setSelectionRange(3, 3);
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "PageDown" });
    composer(parent).dispatchEvent(event);

    expect(threadScrollFromComposer).toHaveBeenCalledWith({ kind: "scroll-by", direction: 1, amount: "page" });
    expect(event.defaultPrevented).toBe(true);
  });

  it("scrolls to stream edges from the composer even when line edge scrolling is disabled", () => {
    const threadScrollFromComposer = vi.fn();
    const { controller, parent, stateStore } = composerControllerFixture({ controller: { threadScrollFromComposer } });

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
    const threadScrollFromComposer = vi.fn();
    const { controller, parent, stateStore } = composerControllerFixture({ controller: { threadScrollFromComposer } });

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
    const { controller, parent } = composerControllerFixture({ stateStore });

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

function skill(name: string): SkillMetadata {
  return {
    name,
    description: `${name} description`,
    path: `/vault/skills/${name}/SKILL.md`,
    enabled: true,
  };
}

function defaultComposerProjection(_model: ChatPanelComposerModel) {
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

function attachmentFixture(name: string): ComposerAttachment {
  return {
    kind: "image",
    name,
    path: `Codex Attachments/${name}.png`,
    marker: `![[Codex Attachments/${name}.png]]`,
  };
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
