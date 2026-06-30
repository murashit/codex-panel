import type { App, EditorPosition, EventRef } from "obsidian";
import { MarkdownView, TFile } from "obsidian";

import type {
  ComposerContextRange,
  ComposerContextReferenceProvider,
  ComposerContextReferences,
} from "../../application/composer/context-references";
import { displayNameForFile, linktextForFile } from "./vault-note-links.obsidian";

interface EventSource {
  offref?(ref: EventRef): void;
}

export class VaultComposerContextReferenceProvider implements ComposerContextReferenceProvider {
  private readonly unregisterEvents: (() => void)[] = [];
  private lastMarkdownView: MarkdownView | null = null;

  constructor(private readonly app: App) {
    this.registerEvent(
      app.workspace,
      app.workspace.on("active-leaf-change", () => {
        this.refreshLastMarkdownView();
      }),
    );
    this.registerEvent(
      app.workspace,
      app.workspace.on("file-open", () => {
        this.refreshLastMarkdownView();
      }),
    );
    this.refreshLastMarkdownView();
  }

  contextReferences(sourcePath: string): ComposerContextReferences {
    const view = this.validLastMarkdownView();
    const activeFile = view?.file ?? this.activeFile();
    const activeNote = activeFile
      ? {
          name: displayNameForFile(activeFile),
          path: activeFile.path,
          linktext: linktextForFile(this.app, activeFile, sourcePath || activeFile.path),
        }
      : null;
    return {
      activeNote,
      selection: view ? selectionContextReference(this.app, view, sourcePath) : null,
    };
  }

  dispose(): void {
    for (const unregister of this.unregisterEvents.splice(0)) {
      unregister();
    }
  }

  private registerEvent(source: EventSource, ref: EventRef): void {
    this.unregisterEvents.push(() => {
      source.offref?.(ref);
    });
  }

  private refreshLastMarkdownView(): void {
    const view = this.activeMarkdownView();
    if (view?.file) this.lastMarkdownView = view;
  }

  private activeMarkdownView(): MarkdownView | null {
    const workspace = this.app.workspace as Partial<Pick<App["workspace"], "getActiveViewOfType">>;
    return workspace.getActiveViewOfType?.(MarkdownView) ?? null;
  }

  private activeFile(): TFile | null {
    const workspace = this.app.workspace as Partial<Pick<App["workspace"], "getActiveFile">>;
    return workspace.getActiveFile?.() ?? null;
  }

  private validLastMarkdownView(): MarkdownView | null {
    const view = this.lastMarkdownView;
    if (!view?.file) return null;
    return this.app.vault.getAbstractFileByPath(view.file.path) instanceof TFile ? view : null;
  }
}

function selectionContextReference(app: App, view: MarkdownView, sourcePath: string): ComposerContextReferences["selection"] {
  const file = view.file;
  if (!file) return null;
  const text = view.editor.getSelection();
  if (!text.trim()) return null;
  return {
    name: displayNameForFile(file),
    path: file.path,
    linktext: linktextForFile(app, file, sourcePath || file.path),
    range: editorSelectionRange(view.editor.getCursor("from"), view.editor.getCursor("to")),
    text,
  };
}

function editorSelectionRange(from: EditorPosition, to: EditorPosition): ComposerContextRange {
  return {
    from: { line: from.line, ch: from.ch },
    to: { line: to.line, ch: to.ch },
  };
}
