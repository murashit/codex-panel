import type { ComposerInputSnapshot } from "../../../../src/features/chat/application/composer/input-snapshot";

export function emptyComposerInputSnapshot(): ComposerInputSnapshot {
  return {
    availableSkills: [],
    referenceActiveNoteOnSend: false,
    contextReferences: { activeNote: null, selection: null },
    activeNoteSnapshots: [],
    selectionSnapshots: [],
    attachments: [],
  };
}
