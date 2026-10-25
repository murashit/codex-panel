interface ComposerContextPosition {
  line: number;
  ch: number;
}

export interface ComposerContextRange {
  from: ComposerContextPosition;
  to: ComposerContextPosition;
}

export interface ActiveNoteContextReference {
  name: string;
  path: string;
  linktext: string;
}

export type SelectionContextReference = ActiveNoteContextReference & {
  text: string;
} & ({ range: ComposerContextRange } | { range: null; selectionId: string });

export interface SelectionContextSnapshot {
  readonly reference: SelectionContextReference;
  readonly marker: string;
}

export interface ComposerContextReferences {
  activeNote: ActiveNoteContextReference | null;
  selection: SelectionContextReference | null;
  activeNoteSnapshots?: readonly ActiveNoteContextReference[];
  selectionSnapshots?: readonly SelectionContextSnapshot[];
}

export interface ComposerSelectionEmphasis {
  setEnabled(enabled: boolean): void;
  release(): void;
}

export interface ComposerContextReferenceProvider {
  contextReferences(sourcePath: string): ComposerContextReferences;
  retainSelectionEmphasis(selection: SelectionContextReference): ComposerSelectionEmphasis | null;
  dispose(): void;
}

export function formatComposerContextRange(range: ComposerContextRange): string {
  return `${formatComposerContextPosition(range.from)}-${formatComposerContextPosition(range.to)}`;
}

export function activeNoteContextReferenceMarker(activeNote: ActiveNoteContextReference): string {
  return `[[${activeNote.linktext}]]`;
}

function formatComposerContextPosition(position: ComposerContextPosition): string {
  return `${String(position.line + 1)}:${String(position.ch + 1)}`;
}
