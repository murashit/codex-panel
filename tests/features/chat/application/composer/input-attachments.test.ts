import { describe, expect, it, vi } from "vitest";
import type {
  ComposerAttachmentHandler,
  ComposerAttachmentSaveResult,
} from "../../../../../src/features/chat/application/composer/attachments";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { deferred } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import {
  attachmentFixture,
  attachmentSaveResult,
  contextProvider,
  installComposerInputFixtures,
  resumeComposerThread,
} from "../../support/composer-input-fixture";
import { chatStateFixture } from "../../support/state";

const createInput = installComposerInputFixtures();

describe("ComposerInput attachment lifetime", () => {
  it("settles pending placeholders when an ephemeral conversation expires while preserving the draft", async () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({
      type: "active-thread/resumed",
      ...threadActivationFixture(panelThreadFixture({ id: "ephemeral" })),
      lifetime: { kind: "ephemeral", mode: "side-chat", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });
    const onAttachmentError = vi.fn();
    const { input, select, view, saved } = pendingAttachmentFixture({ stateStore, onAttachmentError });
    input.setDraft("keep selected text");
    select(5, 13);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);

    stateStore.dispatch({ type: "connection/scoped-cleared" });
    expect(input.draft).toBe("keep selected text");
    expect(view.setSelection).toHaveBeenLastCalledWith({ value: "keep selected text", start: 13, end: 13, direction: "none" });
    expect(input.attachmentSaveBlocksSubmit(false)).toBe(false);
    saved.reject(new Error("Old save failed"));
    await saved.promise.catch(() => undefined);
    expect(onAttachmentError).not.toHaveBeenCalled();
    expect(input.draft).toBe("keep selected text");
    expect(input.attachmentSaveBlocksSubmit(false)).toBe(false);
  });

  it.each(["created", "adopted"] as const)("keeps next-draft attachments across a %s conversation", async (transition) => {
    const { input, stateStore, select, saved } = pendingAttachmentFixture();
    if (transition === "adopted") resumeComposerThread(stateStore, "original");
    input.setDraft("First prompt");
    const claim = input.claimSubmission();
    input.setDraft("Next draft");
    select(10, 10);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);
    if (transition === "adopted") claim?.adoptPanelTarget("created");
    resumeComposerThread(stateStore, "created", transition === "created");
    expect(input.attachmentSaveBlocksSubmit(false)).toBe(true);
    saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    claim?.settle("failed");
    expect(input.draft).toBe("First prompt\n\nNext draft\n![[Codex Attachments/first.png]]");
    expect(input.captureInputSnapshot().attachments).toEqual([attachmentFixture("first")]);
  });

  it("keeps a pending attachment at its placeholder while the draft is edited", async () => {
    const { input, saved, edit, select, stateStore, view } = pendingAttachmentFixture();
    input.setDraft("before after");
    select(6, 6);
    input.transferAttachments([new File(["image"], "first.png", { type: "image/png" })]);

    edit(`edited ${input.draft}`);
    select(input.draft.length - 3);
    saved.resolve(attachmentSaveResult([attachmentFixture("first")]));
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));

    const expectedDraft = "edited before\n![[Codex Attachments/first.png]]\n after";
    expect(input.draft).toBe(expectedDraft);
    expect(view.setSelection).toHaveBeenLastCalledWith({
      value: expectedDraft,
      start: expectedDraft.length - 3,
      end: expectedDraft.length - 3,
      direction: "none",
    });
    expect(input.captureInputSnapshot().attachments).toEqual([attachmentFixture("first")]);
  });

  it("prunes captured note context when an attachment replaces its draft marker", async () => {
    const activeNote = { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" };
    const { input, edit, select, insertFirstSuggestion, stateStore, saved } = pendingAttachmentFixture({
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
    const selection = {
      name: "Alpha",
      path: "notes/Alpha.md",
      linktext: "Alpha",
      range: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } },
      text: "text",
    };
    const emphasis = { release: vi.fn(), setEnabled: vi.fn() };
    const onAttachmentError = vi.fn();
    const { input, edit, select, insertFirstSuggestion, stateStore, saved } = pendingAttachmentFixture({
      onAttachmentError,
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
    expect(onAttachmentError.mock.calls).toEqual(outcome === "failed" ? [["Attachment save failed."]] : []);
  });

  it.each([
    { threadId: "another-thread", outcome: "resolved" },
    { threadId: "original-thread", outcome: "resolved" },
    { threadId: "another-thread", outcome: "rejected" },
    { threadId: "original-thread", outcome: "rejected" },
  ])("ignores a stale $outcome transfer after navigation to $threadId", async ({ threadId, outcome }) => {
    const earlier = deferred<ComposerAttachmentSaveResult>();
    const current = deferred<ComposerAttachmentSaveResult>();
    const onAttachmentError = vi.fn();
    const { input, stateStore } = createInput({
      stateStore: createChatStateStore(chatStateFixture({ activeThread: { id: "original-thread" } })),
      attachmentHandler: {
        saveFiles: vi
          .fn<ComposerAttachmentHandler["saveFiles"]>()
          .mockReturnValueOnce(earlier.promise)
          .mockReturnValueOnce(current.promise),
      },
      onAttachmentError,
    });
    input.setDraft("Original draft");
    input.transferAttachments([new File(["old image"], "earlier.png")]);
    resumeComposerThread(stateStore, "another-thread");
    if (threadId === "original-thread") resumeComposerThread(stateStore, threadId);
    input.setDraft("Current draft");
    input.transferAttachments([new File(["current image"], "current.png")]);
    if (outcome === "resolved") {
      earlier.resolve({ attachments: [attachmentFixture("earlier")], failures: [{ name: "broken.txt", message: "Write failed" }] });
    } else earlier.reject(new Error("Could not create attachment folder"));
    await earlier.promise.catch(() => undefined);
    expect(onAttachmentError).not.toHaveBeenCalled();
    expect(input.attachmentSaveBlocksSubmit(false)).toBe(true);
    current.resolve(attachmentSaveResult([attachmentFixture("current")]));
    await vi.waitFor(() => expect(input.captureInputSnapshot().attachments).toEqual([attachmentFixture("current")]));
    expect(input.draft).toBe("Current draft\n![[Codex Attachments/current.png]]");
    expect(input.captureInputSnapshot().attachments).toEqual([attachmentFixture("current")]);
    expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]);
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

  it("ignores partial attachment results after disposal", async () => {
    const onAttachmentError = vi.fn();
    const { input, stateStore, dispose, saved } = pendingAttachmentFixture({ onAttachmentError });
    input.transferAttachments([new File(["image"], "diagram.png")]);
    dispose();
    saved.resolve({ attachments: [attachmentFixture("diagram")], failures: [{ name: "broken.txt", message: "Write failed" }] });
    await saved.promise;
    await vi.waitFor(() => expect(stateStore.getState().composer.pendingAttachmentSaveIds).toEqual([]));
    expect(input.captureInputSnapshot().attachments).toEqual([]);
    expect(onAttachmentError).not.toHaveBeenCalled();
  });

  it.each([
    { target: "current", outcome: "saved" },
    { target: "adopted", outcome: "saved" },
    { target: "current", outcome: "failed" },
    { target: "adopted", outcome: "failed" },
    { target: "current", outcome: "restored" },
    { target: "adopted", outcome: "restored" },
  ])("keeps $target input ownership after marker removal ($outcome)", async ({ target, outcome }) => {
    const onAttachmentError = vi.fn();
    const { input, stateStore, edit, select, view, saved } = pendingAttachmentFixture({ onAttachmentError });
    resumeComposerThread(stateStore, "original");
    input.setDraft("/resume second");
    const claim = input.claimSubmission();
    input.setDraft("Keep this draft");
    input.transferAttachments([new File(["image"], "diagram.png", { type: "image/png" })]);
    const pendingDraft = input.draft;
    view.setSelection.mockClear();
    edit("Keep this edited draft");
    expect(view.setSelection).not.toHaveBeenCalled();
    expect(input.attachmentSaveBlocksSubmit(false)).toBe(false);
    if (outcome === "restored") edit(pendingDraft);
    select(5);
    if (target === "adopted") {
      claim?.adoptPanelTarget("second");
      resumeComposerThread(stateStore, "second");
    }
    expect(input.attachmentSaveBlocksSubmit(false)).toBe(outcome === "restored");
    expect(view.selection().start).toBe(5);
    if (outcome !== "failed") saved.resolve(attachmentSaveResult([attachmentFixture("diagram")]));
    else saved.reject(new Error("Attachment save failed."));
    await saved.promise.catch(() => undefined);

    expect(input.draft).toBe(outcome === "restored" ? "Keep this draft\n![[Codex Attachments/diagram.png]]" : "Keep this edited draft");
    expect(input.captureInputSnapshot().attachments).toEqual(outcome === "restored" ? [attachmentFixture("diagram")] : []);
    expect(input.attachmentSaveBlocksSubmit(false)).toBe(false);
    expect(view.selection().start).toBe(5);
    expect(onAttachmentError.mock.calls).toEqual(outcome === "failed" ? [["Attachment save failed."]] : []);
    claim?.settle("accepted");
  });
});
function pendingAttachmentFixture(
  overrides: Partial<import("../../../../../src/features/chat/application/composer/input").ComposerInputOptions> = {},
) {
  const saved = deferred<ComposerAttachmentSaveResult>();
  return { ...createInput({ ...overrides, attachmentHandler: { saveFiles: () => saved.promise } }), saved };
}
