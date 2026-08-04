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

export interface SelectionContextReference {
  name: string;
  path: string;
  linktext: string;
  range: ComposerContextRange;
  text: string;
}

export interface ComposerContextReferences {
  activeNote: ActiveNoteContextReference | null;
  selection: SelectionContextReference | null;
  activeNoteSnapshots?: readonly ActiveNoteContextReference[];
  selectionSnapshots?: readonly SelectionContextReference[];
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

export function selectionContextReferenceMarker(selection: SelectionContextReference): string {
  return `[[${selection.linktext}]] (${formatComposerContextRange(selection.range)})`;
}

export function activeNoteContextReferenceMarker(activeNote: ActiveNoteContextReference): string {
  return `[[${activeNote.linktext}]]`;
}

function formatComposerContextPosition(position: ComposerContextPosition): string {
  return `L${String(position.line + 1)}:C${String(position.ch + 1)}`;
}
