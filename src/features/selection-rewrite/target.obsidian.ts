import { type ChangeDesc, type Extension, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Editor, type EditorPosition, editorInfoField, type MarkdownView, type TFile } from "obsidian";

export interface RewriteTarget {
  resolve(): { from: EditorPosition; to: EditorPosition } | null;
  release(): void;
}

interface TargetRecord {
  from: number;
  to: number;
  isCurrent(): boolean;
}

export function createRewriteTargets(): {
  extension: Extension;
  capture(editor: Editor, source: MarkdownView, range: { from: number; to: number }): RewriteTarget | null;
} {
  const changed = StateEffect.define();

  class TargetView {
    decorations: DecorationSet = Decoration.none;
    private target: TargetRecord | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      let target = this.target;
      if (target && !target.isCurrent()) target = null;
      for (const transaction of update.transactions) {
        if (!target) break;
        if (changesTouchTarget(transaction.changes, target)) {
          target = null;
          break;
        }
        target.from = transaction.changes.mapPos(target.from, 1);
        target.to = transaction.changes.mapPos(target.to, -1);
      }
      this.target = target;
      this.decorations = target
        ? Decoration.set([Decoration.mark({ class: "codex-panel-selection-emphasis" }).range(target.from, target.to)])
        : Decoration.none;
    }

    capture(editor: Editor, file: TFile, range: { from: number; to: number }): RewriteTarget | null {
      const path = file.path;
      const target: TargetRecord = {
        ...range,
        isCurrent: () => {
          const info = this.view.state.field(editorInfoField, false);
          return info?.editor === editor && info.file === file && file.path === path && this.view.dom.isConnected;
        },
      };
      if (!target.isCurrent() || range.from < 0 || range.to <= range.from || range.to > this.view.state.doc.length) return null;
      this.target = target;
      this.view.dispatch({ effects: changed.of(null) });
      return {
        resolve: () => {
          if (!target.isCurrent()) this.release(target);
          return this.target === target ? { from: editor.offsetToPos(target.from), to: editor.offsetToPos(target.to) } : null;
        },
        release: () => {
          this.release(target);
        },
      };
    }

    private release(target: TargetRecord): void {
      if (this.target !== target) return;
      this.target = null;
      this.view.dispatch({ effects: changed.of(null) });
    }

    destroy(): void {
      this.target = null;
    }
  }

  const extension = ViewPlugin.fromClass(TargetView, { decorations: (plugin) => plugin.decorations });
  return {
    extension,
    capture: (editor, source, range) => {
      const view = EditorView.findFromDOM(source.containerEl);
      return source.file && view ? (view.plugin(extension)?.capture(editor, source.file, range) ?? null) : null;
    },
  };
}

function changesTouchTarget(changes: ChangeDesc, target: { from: number; to: number }): boolean {
  let touched = false;
  changes.iterChangedRanges((from, to) => {
    if (from === to ? target.from < from && from < target.to : from < target.to && to > target.from) touched = true;
  }, true);
  return touched;
}
