import type { Extension, Facet, Text } from "@codemirror/state";
import type { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type { Editor, EditorPosition, Plugin } from "obsidian";

interface RetainedSelectionEmphasis {
  from: number;
  to: number;
  document: Text;
  visible: boolean;
}

export interface EditorSelectionEmphasis {
  setVisible(visible: boolean): void;
  release(): void;
}

interface HostDecoration {
  mark(spec: { class: string }): Decoration;
  set(ranges: readonly unknown[], sort?: boolean): DecorationSet;
}

interface HostEditorViewConstructor {
  decorations: Facet<
    DecorationSet | ((view: EditorView) => DecorationSet),
    readonly (DecorationSet | ((view: EditorView) => DecorationSet))[]
  >;
}

const emphasesByView = new WeakMap<EditorView, Map<number, RetainedSelectionEmphasis>>();
let registerExtension: ((extension: Extension) => void) | null = null;
let hostDecoration: HostDecoration | null = null;
let extensionRegistered = false;
let nextSelectionEmphasisId = 1;

export function registerEditorSelectionEmphasis(plugin: Plugin): void {
  registerExtension = (extension) => {
    plugin.registerEditorExtension(extension);
  };
  plugin.register(() => {
    registerExtension = null;
    hostDecoration = null;
    extensionRegistered = false;
  });
}

export function retainEditorSelectionEmphasis(
  editor: Editor,
  range: { from: EditorPosition; to: EditorPosition },
): EditorSelectionEmphasis | null {
  const view = editorViewFromEditor(editor);
  const decoration = view ? (hostDecoration ?? hostDecorationFromView(view)) : null;
  if (!view || !decoration || !registerExtension) return null;

  const from = editor.posToOffset(range.from);
  const to = editor.posToOffset(range.to);
  if (from < 0 || to <= from || to > view.state.doc.length) return null;

  hostDecoration = decoration;
  const emphases = emphasesByView.get(view) ?? new Map<number, RetainedSelectionEmphasis>();
  emphasesByView.set(view, emphases);
  const id = nextSelectionEmphasisId;
  nextSelectionEmphasisId += 1;
  const emphasis = { from, to, document: view.state.doc, visible: true };
  emphases.set(id, emphasis);

  if (!extensionRegistered) {
    const viewConstructor = view.constructor as unknown as HostEditorViewConstructor;
    registerExtension(viewConstructor.decorations.of(selectionEmphasisDecorations));
    extensionRegistered = true;
  }
  refreshEditorView(view);

  let retained = true;
  return {
    setVisible: (visible) => {
      if (!retained || emphasis.visible === visible) return;
      emphasis.visible = visible;
      refreshEditorView(view);
    },
    release: () => {
      if (!retained) return;
      retained = false;
      emphases.delete(id);
      refreshEditorView(view);
    },
  };
}

function selectionEmphasisDecorations(view: EditorView): DecorationSet {
  const decoration = hostDecoration;
  if (!decoration) throw new Error("Selection emphasis decoration is unavailable.");
  const ranges = [...(emphasesByView.get(view)?.values() ?? [])]
    .filter((emphasis) => emphasis.visible && emphasis.document === view.state.doc)
    .map((emphasis) => decoration.mark({ class: "codex-panel-selection-emphasis" }).range(emphasis.from, emphasis.to));
  return decoration.set(ranges, true);
}

function refreshEditorView(view: EditorView): void {
  if (view.dom.isConnected) view.dispatch({});
}

function hostDecorationFromView(view: EditorView): HostDecoration | null {
  const viewConstructor = view.constructor as unknown as HostEditorViewConstructor;
  const providers = view.state.facet(viewConstructor.decorations);
  for (const provider of providers) {
    const decorations = decorationSetFromProvider(provider, view);
    const sample = decorations ? firstDecoration(decorations, view.state.doc.length) : null;
    const decorationApi = sample ? decorationConstructor(sample) : null;
    if (decorationApi) return decorationApi;
  }
  return null;
}

function firstDecoration(decorations: DecorationSet, documentLength: number): Decoration | null {
  let sample: Decoration | undefined;
  decorations.between(0, documentLength, (_from, _to, decoration) => {
    sample ??= decoration;
  });
  return sample ?? null;
}

function decorationSetFromProvider(provider: unknown, view: EditorView): DecorationSet | null {
  if (typeof provider !== "function") return provider as DecorationSet;
  try {
    return (provider as (editorView: EditorView) => DecorationSet)(view);
  } catch {
    return null;
  }
}

function decorationConstructor(decoration: Decoration): HostDecoration | null {
  let candidateConstructor: unknown = decoration.constructor;
  while (typeof candidateConstructor === "function") {
    const candidate = candidateConstructor as unknown as Partial<HostDecoration>;
    if (typeof candidate.mark === "function" && typeof candidate.set === "function") return candidate as HostDecoration;
    candidateConstructor = Object.getPrototypeOf(candidateConstructor);
  }
  return null;
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
