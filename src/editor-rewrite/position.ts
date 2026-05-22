import type { Editor } from "obsidian";

export function positionRewritePopover(root: HTMLElement, editor: Editor, margin: number): boolean {
  if (!root.isConnected) return false;

  const view = editorViewFromEditor(editor);
  if (view?.dom instanceof HTMLElement && !view.dom.isConnected) return false;

  const anchor = selectionRect() ?? editorCursorRect(editor) ?? root.ownerDocument.body.getBoundingClientRect();
  const size = root.getBoundingClientRect();
  const viewportWidth = activeWindow.innerWidth;
  const viewportHeight = activeWindow.innerHeight;
  const left = clamp(anchor.left, margin, viewportWidth - size.width - margin);
  const belowTop = anchor.bottom + margin;
  const aboveTop = anchor.top - size.height - margin;
  const top = belowTop + size.height <= viewportHeight - margin ? belowTop : clamp(aboveTop, margin, viewportHeight - size.height - margin);

  root.style.left = `${String(left)}px`;
  root.style.top = `${String(top)}px`;
  return true;
}

function selectionRect(): DOMRect | null {
  const selection = activeWindow.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

function editorCursorRect(editor: Editor): DOMRect | null {
  const view = editorViewFromEditor(editor);
  if (!view) return null;

  const offset = editor.posToOffset(editor.getCursor("to"));
  if (typeof view.coordsAtPos === "function") {
    return view.coordsAtPos(offset, 1) ?? view.coordsAtPos(offset, -1) ?? null;
  }
  return view.dom instanceof HTMLElement ? view.dom.getBoundingClientRect() : null;
}

function editorViewFromEditor(editor: Editor): { coordsAtPos?: (pos: number, side?: -1 | 1) => DOMRect | null; dom?: unknown } | null {
  const candidate = editor as {
    cm?: unknown;
    editor?: { cm?: unknown };
  };
  if (isEditorView(candidate.cm)) return candidate.cm;
  if (isEditorView(candidate.editor?.cm)) return candidate.editor.cm;
  return null;
}

function isEditorView(value: unknown): value is { coordsAtPos?: (pos: number, side?: -1 | 1) => DOMRect | null; dom?: unknown } {
  return Boolean(value && typeof value === "object" && ("coordsAtPos" in value || "dom" in value));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
