import type { CodexInput } from "../../../../domain/input/input";
import { codexInputWithComposerAttachments } from "./attachments";
import { activeNoteContextReferenceMarker, selectionContextReferenceMarker } from "./context-references";
import type { ComposerInputSnapshot } from "./input-snapshot";
import type { NoteCandidateProvider } from "./note-context";
import { preparedUserInputWithWikiLinkReferencesSkillsAndContext } from "./wikilink-context";

export interface PreparedInput {
  text: string;
  input: CodexInput;
}

export function prepareComposerInput(
  text: string,
  snapshot: ComposerInputSnapshot,
  resolveFileReference: NoteCandidateProvider["resolveFileReference"],
): PreparedInput {
  const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
    text,
    (target) => resolveFileReference(target, snapshot.sourcePath),
    snapshot.availableSkills,
    composerContextReferences(snapshot, text),
    { referenceActiveNoteOnSend: snapshot.referenceActiveNoteOnSend },
  );
  return {
    text: prepared.text,
    input: codexInputWithComposerAttachments(prepared.text, prepared.input, snapshot.attachments),
  };
}

export function composerContextReferences(snapshot: ComposerInputSnapshot, text: string | null = null) {
  const activeNoteSnapshots =
    text === null
      ? snapshot.activeNoteSnapshots
      : snapshot.activeNoteSnapshots.filter((activeNote) => text.includes(activeNoteContextReferenceMarker(activeNote)));
  const selectionSnapshots =
    text === null
      ? snapshot.selectionSnapshots
      : snapshot.selectionSnapshots.filter((selection) => text.includes(selectionContextReferenceMarker(selection)));
  return { ...snapshot.contextReferences, activeNoteSnapshots, selectionSnapshots };
}
