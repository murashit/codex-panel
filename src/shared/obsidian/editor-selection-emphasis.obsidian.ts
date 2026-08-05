import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { Editor, EditorPosition } from "obsidian";

interface RetainedSelectionEmphasis {
  from: number;
  to: number;
  visible: boolean;
}

interface SelectionEmphasisVisibility {
  id: number;
  visible: boolean;
}

export interface EditorSelectionEmphasis {
  setVisible(visible: boolean): void;
  release(): void;
}

const retainSelectionEmphasis = StateEffect.define<RetainedSelectionEmphasis & { id: number }>();
const setSelectionEmphasisVisibility = StateEffect.define<SelectionEmphasisVisibility>();
const releaseSelectionEmphasis = StateEffect.define<number>();
const selectionEmphasisField = StateField.define<ReadonlyMap<number, RetainedSelectionEmphasis>>({
  create: () => new Map(),
  update: (emphases, transaction) => {
    if (transaction.docChanged) return new Map();
    let next = emphases;
    for (const effect of transaction.effects) {
      if (effect.is(retainSelectionEmphasis)) {
        next = new Map(next).set(effect.value.id, effect.value);
      } else if (effect.is(setSelectionEmphasisVisibility)) {
        const emphasis = next.get(effect.value.id);
        if (!emphasis || emphasis.visible === effect.value.visible) continue;
        next = new Map(next).set(effect.value.id, { ...emphasis, visible: effect.value.visible });
      } else if (effect.is(releaseSelectionEmphasis) && next.has(effect.value)) {
        const remaining = new Map(next);
        remaining.delete(effect.value);
        next = remaining;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, selectionEmphasisDecorations),
});
let nextSelectionEmphasisId = 1;

export const editorSelectionEmphasisExtension: Extension = selectionEmphasisField;

export function retainEditorSelectionEmphasis(
  editor: Editor,
  range: { from: EditorPosition; to: EditorPosition },
): EditorSelectionEmphasis | null {
  const view = editorViewFromEditor(editor);
  if (!view || view.state.field(selectionEmphasisField, false) === undefined) return null;

  const from = editor.posToOffset(range.from);
  const to = editor.posToOffset(range.to);
  if (from < 0 || to <= from || to > view.state.doc.length) return null;

  const id = nextSelectionEmphasisId;
  nextSelectionEmphasisId += 1;
  view.dispatch({ effects: retainSelectionEmphasis.of({ id, from, to, visible: true }) });

  let retained = true;
  return {
    setVisible: (visible) => {
      if (!retained) return;
      view.dispatch({ effects: setSelectionEmphasisVisibility.of({ id, visible }) });
    },
    release: () => {
      if (!retained) return;
      retained = false;
      view.dispatch({ effects: releaseSelectionEmphasis.of(id) });
    },
  };
}

function selectionEmphasisDecorations(emphases: ReadonlyMap<number, RetainedSelectionEmphasis>): DecorationSet {
  return Decoration.set(
    [...emphases.values()]
      .filter((emphasis) => emphasis.visible)
      .map((emphasis) => Decoration.mark({ class: "codex-panel-selection-emphasis" }).range(emphasis.from, emphasis.to)),
    true,
  );
}

function editorViewFromEditor(editor: Editor): EditorView | null {
  const candidate = editor as Editor & { cm?: unknown };
  return isEditorView(candidate.cm) ? candidate.cm : null;
}

function isEditorView(value: unknown): value is EditorView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EditorView>;
  return Boolean(candidate.state && candidate.dom && typeof candidate.dispatch === "function");
}
