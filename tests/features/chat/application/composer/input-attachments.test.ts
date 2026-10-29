import { describe, expect, it, vi } from "vitest";
import type {
  ComposerAttachment,
  ComposerAttachmentHandler,
  ComposerAttachmentSaveResult,
} from "../../../../../src/features/chat/application/composer/attachments";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { deferred } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import {
  attachmentFixture,
  attachmentSaveResult,
  contextProvider,
  installComposerInputFixtures,
} from "../../support/composer-input-fixture";
import { chatStateFixture, chatStateWith } from "../../support/state";

const createInput = installComposerInputFixtures();

describe("ComposerInput attachment lifetime", () => {
  it("does not insert a saved attachment into a later thread or draft", async () => {
    const stateStore = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread-first" } }));
    const { input, saved, select } = pendingAttachmentFixture({ stateStore });
    input.setDraft("first draft");
    select(5, 5);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);

    stateStore.dispatch({ type: "active-thread/cleared" });
    input.setDraft("later draft");
    select(2, 2);
    saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    expect(input.draft).toBe("later draft");
    expect(input.captureInputSnapshot().attachments).toEqual([]);
  });

  it("keeps next-draft attachments across initial thread creation", async () => {
    const saved = deferred<ComposerAttachmentSaveResult>();
    const { input, stateStore, select } = createInput({
      attachmentHandler: { saveFiles: () => saved.promise },
    });
    input.setDraft("First prompt");
    const claim = input.claimSubmission();
    input.setDraft("Next draft");
    select(10, 10);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);
    resumeComposerThread(stateStore, "created", true);
    saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    claim?.settle("failed");
    expect(input.draft).toBe("First prompt\n\nNext draft\n![[Codex Attachments/first.png]]");
    expect(input.captureInputSnapshot().attachments).toEqual([attachmentFixture("first")]);
  });

  it("does not insert a saved attachment after leaving and returning to the same thread state", async () => {
    const stateStore = createChatStateStore(chatStateWith(chatStateFixture(), { activeThread: { id: "thread" } }));
    const { input, saved, select } = pendingAttachmentFixture({ stateStore });
    input.setDraft("same draft");
    select(4, 4);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);

    stateStore.dispatch({ type: "active-thread/cleared" });
    resumeComposerThread(stateStore, "thread");
    input.setDraft("same draft");
    select(4, 4);
    saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    expect(input.draft).toBe("same draft");
    expect(input.captureInputSnapshot().attachments).toEqual([]);
  });

  it("keeps a pending attachment at its placeholder while the draft is edited", async () => {
    const { input, saved, edit, select, stateStore } = pendingAttachmentFixture();
    input.setDraft("before after");
    select(6, 6);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);

    edit(`edited ${input.draft}`);
    saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    expect(input.draft).toBe("edited before\n![[Codex Attachments/first.png]]\n after");
    expect(input.captureInputSnapshot().attachments).toEqual([attachmentFixture("first")]);
  });

  it("prunes captured note context when an attachment replaces its draft marker", async () => {
    const saved = deferred<ComposerAttachmentSaveResult>();
    const activeNote = { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" };
    const { input, edit, select, insertFirstSuggestion, stateStore } = createInput({
      attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
      contextReferenceProvider: contextProvider(() => ({ activeNote, selection: null })),
    });
    edit("@active");
    insertFirstSuggestion();
    input.setDraft("[[Alpha]] after");
    expect(input.captureInputSnapshot().activeNoteSnapshots).toEqual([activeNote]);
    select(0, "[[Alpha]]".length);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);

    expect(input.captureInputSnapshot().activeNoteSnapshots).toEqual([activeNote]);
    saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    expect(input.captureInputSnapshot().activeNoteSnapshots).toEqual([]);
  });

  it.each(["saved", "failed"] as const)("retains selection context until attachment replacement is %s", async (outcome) => {
    const saved = deferred<ComposerAttachmentSaveResult>();
    const selection = {
      name: "Alpha",
      path: "notes/Alpha.md",
      linktext: "Alpha",
      range: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } },
      text: "text",
    };
    const emphasis = { release: vi.fn(), setEnabled: vi.fn() };
    const { input, edit, select, insertFirstSuggestion, stateStore } = createInput({
      attachmentHandler: { saveFiles: () => saved.promise },
      contextReferenceProvider: {
        ...contextProvider(() => ({ activeNote: null, selection })),
        retainSelectionEmphasis: () => emphasis,
      },
    });
    edit("@sel");
    insertFirstSuggestion();
    const draft = input.draft;
    expect(input.captureInputSnapshot().selectionSnapshots).toEqual([{ reference: selection, marker: '[[Alpha]] "text"' }]);

    select(0, draft.length);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);
    expect(emphasis.release).not.toHaveBeenCalled();

    if (outcome === "saved") saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    else saved.reject(new Error("Attachment save failed."));
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    const snapshot = input.captureInputSnapshot();
    expect(snapshot.selectionSnapshots).toEqual(outcome === "saved" ? [] : [{ reference: selection, marker: '[[Alpha]] "text"' }]);
    expect(snapshot.attachments).toEqual(outcome === "saved" ? [attachmentFixture("first")] : []);
    expect(emphasis.release).toHaveBeenCalledTimes(outcome === "saved" ? 1 : 0);
    expect(input.draft).toBe(outcome === "saved" ? attachmentFixture("first").marker : draft);
  });

  it("inserts multiple transfers that began at the same draft anchor", async () => {
    const first = deferred<ComposerAttachmentSaveResult>();
    const second = deferred<ComposerAttachmentSaveResult>();
    const { input, select, stateStore } = createInput({
      attachmentHandler: {
        saveFiles: vi.fn<ComposerAttachmentHandler["saveFiles"]>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      },
    });
    input.setDraft("note");
    select(4, 4);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);
    input.transferAttachments([new File(["image"], "second.png", { type: "image/png" })]);

    second.resolve(attachmentSaveResult([attachmentFixture("second")]));
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toHaveLength(1));
    expect(input.draft).toContain("![[Codex Attachments/second.png]]");
    first.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    expect(input.draft).toBe("note\n![[Codex Attachments/first.png]]\n![[Codex Attachments/second.png]]");
    expect(input.captureInputSnapshot().attachments.map((attachment) => attachment.name)).toEqual(["first", "second"]);
  });

  it.each(["switch", "dispose"] as const)("ignores partial attachment results after owner %s", async (action) => {
    const saved = deferred<ComposerAttachmentSaveResult>();
    const onAttachmentError = vi.fn();
    const { input, stateStore, dispose } = createInput({
      attachmentHandler: { saveFiles: () => saved.promise },
      onAttachmentError,
    });
    input.transferAttachments([new File(["image"], "diagram.png")]);
    if (action === "switch") resumeComposerThread(stateStore, "another-thread");
    else dispose();
    saved.resolve({ attachments: [attachmentFixture("diagram")], failures: [{ name: "broken.txt", message: "Write failed" }] });
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    expect(input.captureInputSnapshot().attachments).toEqual([]);
    expect(onAttachmentError).not.toHaveBeenCalled();
  });

  it("does not reinsert a saved attachment after the user removes its placeholder", async () => {
    const saved = deferred<ComposerAttachmentSaveResult>();
    const attachment: ComposerAttachment = {
      kind: "image",
      name: "diagram",
      path: "Codex Attachments/diagram.png",
      marker: "![[Codex Attachments/diagram.png]]",
    };
    const { input, stateStore } = createInput({
      attachmentHandler: { saveFiles: vi.fn(() => saved.promise) },
    });
    input.setDraft("Keep this draft");
    input.transferAttachments([new File(["image"], "diagram.png", { type: "image/png" })]);
    input.setDraft("Keep this edited draft");

    saved.resolve(attachmentSaveResult([attachment]));
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    expect(input.draft).toBe("Keep this edited draft");
    expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]);
  });
});
function resumeComposerThread(stateStore: ChatStateStore, threadId: string, created = false): void {
  stateStore.dispatch({
    ...threadActivationFixture(panelThreadFixture({ id: threadId })),
    type: created ? "active-thread/created" : "active-thread/resumed",
  });
}

function pendingAttachmentFixture(
  overrides: Partial<import("../../../../../src/features/chat/application/composer/input").ComposerInputOptions> = {},
) {
  const saved = deferred<ComposerAttachmentSaveResult>();
  return { ...createInput({ ...overrides, attachmentHandler: { saveFiles: () => saved.promise } }), saved };
}
