import { afterEach, vi } from "vitest";
import type { SkillMetadata } from "../../../../src/domain/runtime/catalog";
import type { Thread } from "../../../../src/domain/threads/model";
import type { ComposerAttachment } from "../../../../src/features/chat/application/composer/attachments";
import type {
  ComposerContextReferenceProvider,
  SelectionContextReference,
} from "../../../../src/features/chat/application/composer/context-references";
import { ComposerInput, type ComposerInputOptions } from "../../../../src/features/chat/application/composer/input";
import type { NoteCandidateProvider } from "../../../../src/features/chat/application/composer/note-context";
import { prepareComposerInput } from "../../../../src/features/chat/application/composer/prepared-input";
import type { ComposerSelection } from "../../../../src/features/chat/application/composer/selection";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { substringMatcher } from "../application/composer/fuzzy-matcher.test-support";

// These providers stand in for Obsidian and shared app-server queries. The input,
// reducer, suggestion preparation and claim lifecycle remain production code.
export function composerInputOptions(overrides: Partial<ComposerInputOptions> = {}): ComposerInputOptions {
  return {
    stateStore: createChatStateStore(),
    attachmentHandler: { saveFiles: async () => attachmentSaveResult([]) },
    fuzzyMatcher: substringMatcher,
    onAttachmentError: vi.fn(),
    sharedResources: sharedResourcesFixture(),
    noteCandidateProvider: noteProvider(),
    contextReferenceProvider: contextProvider(),
    sourcePath: () => "",
    referenceActiveNoteOnSend: () => false,
    view: { selection: () => null, setSelection: () => {}, focus: () => {} },
    ...overrides,
  };
}

// Install in each suite: Vitest reuses imported modules with isolate:false.
export function installComposerInputFixtures() {
  const inputs = new Set<ComposerInput>();
  afterEach(() => {
    for (const input of inputs) input.dispose();
    inputs.clear();
  });
  return (overrides: Partial<Omit<ComposerInputOptions, "view">> = {}) => {
    const stateStore = overrides.stateStore ?? createChatStateStore();
    let cursor: Omit<ComposerSelection, "value"> | null = null;
    let liveValue: string | undefined;
    const view = {
      selection: () => {
        const value = liveValue ?? stateStore.getState().composer.draft;
        return { value, ...(cursor ?? { start: value.length, end: value.length, direction: "none" as const }) };
      },
      setSelection: vi.fn((selection: ComposerSelection | null) => {
        cursor = selection ? { start: selection.start, end: selection.end, direction: selection.direction } : null;
      }),
      focus: vi.fn(),
    };
    const options = composerInputOptions({ ...overrides, stateStore, view });
    const input = new ComposerInput(options);
    inputs.add(input);
    return {
      input,
      stateStore,
      view,
      insertFirstSuggestion: () => {
        const suggestion = stateStore.getState().composer.suggestions[0];
        if (!suggestion) throw new Error(`No suggestion for ${input.draft}`);
        input.insertSuggestion(suggestion, "enter");
      },
      select: (start: number, end = start) => {
        cursor = { start, end, direction: "none" };
      },
      edit: (value: string) => {
        // An input event exposes the new text before the reducer is updated.
        // No renderer or second draft store is needed for this application port.
        liveValue = value;
        cursor = { start: value.length, end: value.length, direction: "none" };
        try {
          input.editDraft(value);
        } finally {
          liveValue = undefined;
        }
      },
      prepareInput: (text: string, snapshot = input.captureInputSnapshot()) =>
        prepareComposerInput(text, snapshot, (target, sourcePath) =>
          options.noteCandidateProvider.resolveFileReference(target, sourcePath),
        ),
      dispose: () => {
        inputs.delete(input);
        input.dispose();
      },
    };
  };
}

export function sharedResourcesFixture(
  options: { skills?: readonly SkillMetadata[]; threads?: readonly Thread[] } = {},
): ComposerInputOptions["sharedResources"] {
  return {
    runtimeConfigSnapshot: () => null,
    rateLimitsSnapshot: () => undefined,
    modelsSnapshot: () => null,
    skillsSnapshot: () => options.skills ?? null,
    permissionProfilesSnapshot: () => null,
    activeThreadsSnapshot: () => options.threads ?? null,
    subscribe: () => () => {},
  };
}

export function noteProvider(overrides: Partial<NoteCandidateProvider> = {}): NoteCandidateProvider {
  return {
    candidates: () => [],
    dailyNoteReferences: () => [],
    tags: () => [],
    resolveFileReference: () => null,
    dispose: vi.fn(),
    ...overrides,
  };
}

export function contextProvider(
  contextReferences: ComposerContextReferenceProvider["contextReferences"] = () => ({ activeNote: null, selection: null }),
): ComposerContextReferenceProvider {
  return { contextReferences, retainSelectionEmphasis: () => null, dispose: vi.fn() };
}

export function readingReference(selectionId: string, text: string): SelectionContextReference {
  return { name: "Alpha", path: "Alpha.md", linktext: "Alpha", range: null, selectionId, text };
}

export function editorReference(text: string, line: number): SelectionContextReference {
  return { name: "Alpha", path: "Alpha.md", linktext: "Alpha", text, range: { from: { line, ch: 0 }, to: { line, ch: text.length } } };
}

export function attachmentSaveResult(attachments: readonly ComposerAttachment[]) {
  return { attachments, failures: [] };
}

export function attachmentFixture(name: string): ComposerAttachment {
  return { kind: "image", name, path: `Codex Attachments/${name}.png`, marker: `![[Codex Attachments/${name}.png]]` };
}
