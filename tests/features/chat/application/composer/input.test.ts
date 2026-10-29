import { describe, expect, it, vi } from "vitest";
import type { ComposerContextReferences } from "../../../../../src/features/chat/application/composer/context-references";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import {
  contextProvider,
  editorReference,
  installComposerInputFixtures,
  noteProvider,
  readingReference,
  sharedResourcesFixture,
} from "../../support/composer-input-fixture";
import { chatStateFixture } from "../../support/state";

const createInput = installComposerInputFixtures();

describe("ComposerInput", () => {
  it("settles accepted and failed claims without losing newer drafts", () => {
    const { input, stateStore } = createInput();
    input.setDraft("first message");
    const claim = input.claimSubmission();
    expect(claim?.text).toBe("first message");
    expect(stateStore.getState().composer.draft).toBe("");

    input.setDraft("next message");
    claim?.settle("accepted");

    expect(stateStore.getState().composer.draft).toBe("next message");
    const nextClaim = input.claimSubmission();
    claim?.settle("failed");
    claim?.adoptPanelTarget("obsolete");
    expect(input.isSubmissionPreparing()).toBe(true);
    expect(nextClaim?.isCurrent()).toBe(true);
    input.setDraft("later message");
    nextClaim?.settle("failed");
    expect(stateStore.getState().composer.draft).toBe("next message\n\nlater message");
  });

  it("places a slash command replacement before a draft typed while the command was running", () => {
    const { input, stateStore } = createInput();
    input.setDraft("/goal");
    const claim = input.claimSubmission();

    input.setDraft("next message");
    claim?.settle("accepted", "/goal set Current objective");

    expect(stateStore.getState().composer.draft).toBe("/goal set Current objective\n\nnext message");
  });

  it.each(["composer", "literal"])("does not revive stale %s input after returning to its original thread", (source) => {
    const stateStore = createChatStateStore();
    resumeComposerThread(stateStore, "first");
    const { input } = createInput({ stateStore });
    input.setDraft("/web https://example.com");
    const staleClaim = source === "composer" ? input.claimSubmission() : input.claimTextSubmission("Side message");

    resumeComposerThread(stateStore, "second");
    resumeComposerThread(stateStore, "first");
    input.setDraft("returned-thread draft");

    expect(input.isSubmissionPreparing()).toBe(false);
    expect(staleClaim?.isCurrent()).toBe(false);
    staleClaim?.settle("failed");
    expect(stateStore.getState().composer.draft).toBe("returned-thread draft");
    expect(input.claimSubmission()).not.toBeNull();
  });

  it("does not carry an adopted submission into an unexpected panel target", () => {
    const stateStore = createChatStateStore();
    resumeComposerThread(stateStore, "source");
    const { input } = createInput({ stateStore });
    input.setDraft("/resume intended");
    const claim = input.claimSubmission();
    input.setDraft("source draft");
    claim?.adoptPanelTarget("intended");

    resumeComposerThread(stateStore, "other");

    expect(stateStore.getState().composer.draft).toBe("");
    expect(input.isSubmissionPreparing()).toBe(false);
    claim?.settle("failed");
    expect(stateStore.getState().composer.draft).toBe("");
  });

  it("places a rollback replacement before the next draft across its adopted target", () => {
    const stateStore = createChatStateStore();
    resumeComposerThread(stateStore, "source");
    const { input } = createInput({ stateStore });
    input.setDraft("/rollback");
    const claim = input.claimSubmission();
    input.setDraft("next message");
    claim?.adoptPanelTarget("rolled-back", "rolled back prompt");

    resumeComposerThread(stateStore, "rolled-back");

    expect(stateStore.getState().composer.draft).toBe("rolled back prompt\n\nnext message");
    claim?.settle("accepted");
    expect(stateStore.getState().composer.draft).toBe("rolled back prompt\n\nnext message");
  });

  it("captures completed thread identity across message edits and drops it when the title token changes", () => {
    const stateStore = createChatStateStore();
    const preview = `Long preview ${"x".repeat(120)}`;
    const completedTitle = `${preview.slice(0, 93)}...`;
    const threads = [panelThreadFixture({ id: "target-thread", preview })];
    const { input, edit, insertFirstSuggestion } = createInput({
      stateStore,
      sharedResources: sharedResourcesFixture({ threads }),
    });
    edit("/refer long");
    insertFirstSuggestion();

    expect(input.draft).toBe(`/refer "${completedTitle}" `);
    expect(input.captureInputSnapshot().threadCommandTarget).toEqual({
      command: "refer",
      threadId: "target-thread",
      title: completedTitle,
    });

    edit(`${input.draft}summarize`);
    expect(input.captureInputSnapshot().threadCommandTarget?.threadId).toBe("target-thread");

    edit(input.draft.replace(completedTitle, "edited title"));
    expect(input.captureInputSnapshot().threadCommandTarget).toBeUndefined();
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
          lifetime: { kind: "ephemeral", mode: "side-chat", sourceThreadId: "source-thread", sourceThreadTitle: "Source" },
        },
      }),
    );
    const { edit } = createInput({ stateStore });

    edit(draft);

    expect(
      stateStore
        .getState()
        .composer.suggestions.map((item) => item.replacement)
        .includes(suggestion),
    ).toBe(available);
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
    const { input, edit, insertFirstSuggestion } = createInput({
      noteCandidateProvider: noteProvider({ dailyNoteReferences }),
      sourcePath: () => "Inbox.md",
    });

    edit("@today");
    insertFirstSuggestion();

    expect(input.draft).toBe("[[Journal/2026-07-10]]");
    expect(dailyNoteReferences).toHaveBeenCalledWith("Inbox.md");
  });

  it("freezes active file context when inserting the active suggestion", () => {
    const stateStore = createChatStateStore();
    let references: ComposerContextReferences = {
      activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
      selection: null,
    };
    const { prepareInput, input, edit, insertFirstSuggestion } = createInput({
      stateStore,
      noteCandidateProvider: noteProvider({ resolveFileReference: () => null }),
      contextReferenceProvider: contextProvider(() => references),
      sourcePath: () => "Inbox.md",
    });

    edit("@active");
    insertFirstSuggestion();
    const completedActiveNoteReference = input.draft;
    const snapshot = input.captureInputSnapshot();
    references = { activeNote: null, selection: null };

    expect(completedActiveNoteReference).toBe("[[Alpha]]");
    expect(prepareInput(completedActiveNoteReference).input).toContainEqual({
      type: "fileReference",
      name: "Alpha",
      path: "notes/Alpha.md",
    });

    input.setDraft("", { clearSuggestions: true });
    expect(prepareInput(completedActiveNoteReference, snapshot).input).toContainEqual({
      type: "fileReference",
      name: "Alpha",
      path: "notes/Alpha.md",
    });
  });

  it("keeps Reading excerpts distinct through claims and failed restoration", () => {
    const prefix = "x".repeat(60);
    let selection = readingReference("capture-a", `${prefix} first excerpt`);
    const { input, prepareInput, edit, insertFirstSuggestion } = createInput({
      contextReferenceProvider: contextProvider(() => ({ activeNote: null, selection })),
    });
    edit("@sel");
    insertFirstSuggestion();
    const firstDraft = input.draft;
    expect(firstDraft).toBe(`[[Alpha]] "${"x".repeat(48)}…"`);
    const claim = input.claimSubmission();
    selection = readingReference("capture-b", `${prefix} second excerpt`);
    edit("@sel");
    insertFirstSuggestion();
    const secondDraft = input.draft;
    expect(secondDraft).toBe(`[[Alpha]] "${"x".repeat(49)}…"`);
    claim?.settle("failed");
    expect(input.captureInputSnapshot().selectionSnapshots.map((snapshot) => snapshot.reference.text)).toEqual([
      `${prefix} first excerpt`,
      `${prefix} second excerpt`,
    ]);

    const context = expectPresent(prepareInput(input.draft).input.find((item) => item.type === "additionalContext"));
    expect(context.kind).toBe("untrusted");
    expect(context.value).toContain("not verified excerpt provenance or an edit location");
    expect(context.value).toContain(`${firstDraft}:\n${prefix} first excerpt`);
    expect(context.value).toContain(`${secondDraft}:\n${prefix} second excerpt`);
  });

  it("keeps later exact source locations separate when the quoted text is identical", () => {
    const first = editorReference("same text", 0);
    let selection = first;
    const { input, prepareInput, edit, insertFirstSuggestion } = createInput({
      contextReferenceProvider: contextProvider(() => ({ activeNote: null, selection })),
    });
    edit("@sel");
    insertFirstSuggestion();
    const plain = '[[Alpha]] "same text"';
    expect(input.draft).toBe(plain);
    const claim = input.claimSubmission();
    selection = { ...first, range: { from: { line: 19, ch: 0 }, to: { line: 19, ch: 9 } } };
    edit("@sel");
    insertFirstSuggestion();
    const located = '[[Alpha]] (20:1-20:10) "same text"';
    expect(input.draft).toBe(located);
    claim?.settle("failed");
    expect(input.draft).toBe(`${plain}\n\n${located}`);
    expect(input.captureInputSnapshot().selectionSnapshots).toHaveLength(2);

    // Removing one citation keeps only the other exact source location.
    edit(located);
    expect(input.captureInputSnapshot().selectionSnapshots).toEqual([{ reference: selection, marker: located }]);
    const context = prepareInput(located).input.find((item) => item.type === "additionalContext");
    expect(context).toMatchObject({ value: expect.stringContaining("source range 20:1-20:10") });
    expect(context).toMatchObject({ value: expect.not.stringContaining("source range 1:1-1:10") });

    edit(located.replace("same text", "same tex"));
    expect(input.captureInputSnapshot().selectionSnapshots).toEqual([]);
  });

  it("does not rebind a damaged coordinate citation to the first source location", () => {
    const first = editorReference("same text", 0);
    let selection = first;
    const { input, prepareInput, edit, insertFirstSuggestion } = createInput({
      contextReferenceProvider: contextProvider(() => ({ activeNote: null, selection })),
    });
    edit("@sel");
    insertFirstSuggestion();
    const firstMarker = input.draft;
    selection = editorReference("same text", 19);
    edit(`${firstMarker}\n@sel`);
    insertFirstSuggestion();
    expect(input.captureInputSnapshot().selectionSnapshots).toHaveLength(2);
    const damaged = '[[Alpha]] (20:1-20:10 "same text"';
    edit(`${firstMarker}\n${damaged}`);
    expect(input.captureInputSnapshot().selectionSnapshots).toEqual([{ marker: firstMarker, reference: first }]);
    edit(damaged);
    expect(input.captureInputSnapshot().selectionSnapshots).toEqual([]);
    expect(prepareInput(damaged).input).not.toContainEqual(
      expect.objectContaining({ type: "additionalContext", value: expect.stringContaining("source range") }),
    );
  });

  it("reuses a Reading citation while refreshing emphasis from the current original candidate", () => {
    let selection = readingReference("first", "same text");
    const previousEmphasis = { release: vi.fn(), setEnabled: vi.fn() };
    const freshEmphasis = { release: vi.fn(), setEnabled: vi.fn() };
    const retainSelectionEmphasis = vi.fn().mockReturnValueOnce(previousEmphasis).mockReturnValueOnce(freshEmphasis);
    const { input, edit, insertFirstSuggestion } = createInput({
      contextReferenceProvider: {
        ...contextProvider(() => ({ activeNote: null, selection })),
        retainSelectionEmphasis,
      },
    });
    edit("@sel");
    insertFirstSuggestion();
    selection = readingReference("fresh", "same text");
    edit(`${input.draft}\n@sel`);
    insertFirstSuggestion();
    expect(input.draft).toBe('[[Alpha]] "same text"\n[[Alpha]] "same text"');
    expect(input.captureInputSnapshot().selectionSnapshots).toHaveLength(1);
    expect(retainSelectionEmphasis).toHaveBeenLastCalledWith(selection);
    expect(previousEmphasis.release).toHaveBeenCalledOnce();
    expect(freshEmphasis.release).not.toHaveBeenCalled();
  });
  it("keeps a captured selection after its provider and editable draft change", () => {
    let selection = { ...editorReference("initial selection", 41), path: "notes/Alpha.md", linktext: "notes/Alpha" };
    const { input, edit, insertFirstSuggestion, prepareInput } = createInput({
      noteCandidateProvider: noteProvider({ resolveFileReference: () => ({ name: "Alpha", path: "notes/Alpha.md" }) }),
      contextReferenceProvider: contextProvider(() => ({ activeNote: null, selection })),
    });
    edit("@sel");
    insertFirstSuggestion();
    const snapshot = input.captureInputSnapshot();
    expect(input.draft).toBe('[[notes/Alpha]] "initial selection"');
    selection = { ...selection, text: "changed selection", path: "notes/Beta.md" };
    input.setDraft("");

    const prepared = prepareInput('[[notes/Alpha]] "initial selection"', snapshot);
    expect(prepared.input).toContainEqual({ type: "fileReference", name: "Alpha", path: "notes/Alpha.md" });
    expect(prepared.input).toContainEqual(
      expect.objectContaining({
        type: "additionalContext",
        kind: "untrusted",
        value: expect.stringContaining('[[notes/Alpha]] "initial selection" -> notes/Alpha.md (source range 42:1-42:18)'),
      }),
    );
    expect(prepared.input).not.toContainEqual(expect.objectContaining({ value: expect.stringContaining("changed selection") }));
    expect(input.captureInputSnapshot().selectionSnapshots).toEqual([]);
    expect(prepareInput('[[notes/Alpha]] "initial selection"').input).toContainEqual(
      expect.objectContaining({
        type: "additionalContext",
        value: "Obsidian references for the current user input:\n- [[notes/Alpha]] -> notes/Alpha.md",
      }),
    );
  });

  it("restores claimed emphasis but keeps the newer owner of a duplicate citation", () => {
    let selection = editorReference("first excerpt", 0);
    const first = { release: vi.fn(), setEnabled: vi.fn() };
    const claimedDuplicate = { release: vi.fn(), setEnabled: vi.fn() };
    const newerDuplicate = { release: vi.fn(), setEnabled: vi.fn() };
    const retainSelectionEmphasis = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(claimedDuplicate)
      .mockReturnValueOnce(newerDuplicate);
    const { input, edit, insertFirstSuggestion } = createInput({
      contextReferenceProvider: { ...contextProvider(() => ({ activeNote: null, selection })), retainSelectionEmphasis },
    });
    edit("@sel");
    insertFirstSuggestion();
    selection = editorReference("second excerpt", 19);
    edit(`${input.draft}\n@sel`);
    insertFirstSuggestion();
    const claim = input.claimSubmission();
    expect(first.setEnabled).toHaveBeenLastCalledWith(false);
    expect(claimedDuplicate.setEnabled).toHaveBeenLastCalledWith(false);
    expect(first.release).not.toHaveBeenCalled();
    expect(claimedDuplicate.release).not.toHaveBeenCalled();

    edit("@sel");
    insertFirstSuggestion();
    claim?.settle("failed");
    expect(first.setEnabled).toHaveBeenLastCalledWith(true);
    expect(claimedDuplicate.release).toHaveBeenCalledOnce();
    expect(newerDuplicate.release).not.toHaveBeenCalled();
    expect(input.captureInputSnapshot().selectionSnapshots.map(({ reference }) => reference.text)).toEqual([
      "first excerpt",
      "second excerpt",
    ]);

    edit('[[Alpha]] "second excerpt"');
    expect(first.release).toHaveBeenCalledOnce();
    expect(newerDuplicate.release).not.toHaveBeenCalled();
    edit("");
    expect(newerDuplicate.release).toHaveBeenCalledOnce();
  });

  it("releases claimed selection emphasis when the submission is accepted", () => {
    const emphasis = { release: vi.fn(), setEnabled: vi.fn() };
    const { input, edit, insertFirstSuggestion } = createInput({
      contextReferenceProvider: {
        ...contextProvider(() => ({ activeNote: null, selection: editorReference("selected", 0) })),
        retainSelectionEmphasis: () => emphasis,
      },
    });
    edit("@sel");
    insertFirstSuggestion();
    const claim = input.claimSubmission();
    expect(emphasis.setEnabled).toHaveBeenLastCalledWith(false);
    expect(emphasis.release).not.toHaveBeenCalled();
    claim?.settle("accepted");
    expect(emphasis.release).toHaveBeenCalledOnce();
    expect(input.captureInputSnapshot().selectionSnapshots).toEqual([]);
  });
});
function resumeComposerThread(stateStore: ChatStateStore, threadId: string, created = false): void {
  stateStore.dispatch({
    ...threadActivationFixture(panelThreadFixture({ id: threadId })),
    type: created ? "active-thread/created" : "active-thread/resumed",
  });
}

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
  return value as T;
}
