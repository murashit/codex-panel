interface ComposerContextPosition {
  line: number;
  ch: number;
}

export interface ComposerContextRange {
  from: ComposerContextPosition;
  to: ComposerContextPosition;
}

interface ActiveNoteContextReference {
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
  selectionSnapshots?: readonly SelectionContextReference[];
}

export interface ComposerContextReferenceProvider {
  contextReferences(sourcePath: string): ComposerContextReferences;
  dispose(): void;
}

export function emptyComposerContextReferences(): ComposerContextReferences {
  return { activeNote: null, selection: null, selectionSnapshots: [] };
}

export function formatComposerContextRange(range: ComposerContextRange): string {
  return `${formatComposerContextPosition(range.from)}-${formatComposerContextPosition(range.to)}`;
}

export function selectionContextReferenceMarker(selection: SelectionContextReference): string {
  return `[[${selection.linktext}]] (${formatComposerContextRange(selection.range)})`;
}

function formatComposerContextPosition(position: ComposerContextPosition): string {
  return `L${String(position.line + 1)}:C${String(position.ch + 1)}`;
}
