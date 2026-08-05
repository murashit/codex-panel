import type { App, EditorPosition, EventRef } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import {
  type EditorSelectionEmphasis,
  retainEditorSelectionEmphasis,
} from "../../../../shared/obsidian/editor-selection-emphasis.obsidian";
import type {
  ComposerContextRange,
  ComposerContextReferenceProvider,
  ComposerContextReferences,
  ComposerSelectionEmphasis,
  SelectionContextReference,
} from "../../application/composer/context-references";
import { displayNameForFile, linktextForFile } from "./vault-note-links.obsidian";

interface EventSource {
  offref?(ref: EventRef): void;
}

interface PanelSelectionEmphasis {
  readonly decoration: EditorSelectionEmphasis;
  enabled: boolean;
}

export class VaultComposerContextReferenceProvider implements ComposerContextReferenceProvider {
  private readonly shared: SharedComposerContext;
  private readonly selectionEmphases = new Set<PanelSelectionEmphasis>();
  private readonly activeLeafChangeRef: EventRef;
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly isForeground: () => boolean,
  ) {
    this.activeLeafChangeRef = app.workspace.on("active-leaf-change", () => {
      this.syncSelectionEmphasisVisibility();
    });
    const existing = sharedComposerContexts.get(app);
    if (existing) {
      existing.consumers += 1;
      this.shared = existing;
      return;
    }
    this.shared = { tracker: new VaultComposerContextTracker(app), consumers: 1 };
    sharedComposerContexts.set(app, this.shared);
  }

  contextReferences(sourcePath: string): ComposerContextReferences {
    return this.shared.tracker.contextReferences(sourcePath);
  }

  retainSelectionEmphasis(selection: ComposerContextReferences["selection"]): ComposerSelectionEmphasis | null {
    if (this.disposed || !selection) return null;
    const decoration = this.shared.tracker.retainSelectionEmphasis(selection);
    if (!decoration) return null;
    const emphasis = { decoration, enabled: true };
    this.selectionEmphases.add(emphasis);
    decoration.setVisible(this.isForeground());

    let retained = true;
    return {
      setEnabled: (enabled) => {
        if (!retained || emphasis.enabled === enabled) return;
        emphasis.enabled = enabled;
        decoration.setVisible(enabled && this.isForeground());
      },
      release: () => {
        if (!retained) return;
        retained = false;
        this.selectionEmphases.delete(emphasis);
        decoration.release();
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.app.workspace.offref(this.activeLeafChangeRef);
    for (const emphasis of this.selectionEmphases) emphasis.decoration.release();
    this.selectionEmphases.clear();
    this.shared.consumers -= 1;
    if (this.shared.consumers > 0) return;
    this.shared.tracker.dispose();
    sharedComposerContexts.delete(this.app);
  }

  private syncSelectionEmphasisVisibility(): void {
    const visible = this.isForeground();
    for (const emphasis of this.selectionEmphases) emphasis.decoration.setVisible(emphasis.enabled && visible);
  }
}

interface SharedComposerContext {
  readonly tracker: VaultComposerContextTracker;
  consumers: number;
}

const sharedComposerContexts = new WeakMap<App, SharedComposerContext>();

class VaultComposerContextTracker {
  private readonly unregisterEvents: (() => void)[] = [];
  private readonly selectionViews = new WeakMap<SelectionContextReference, MarkdownView>();
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
    const selection = view ? selectionContextReference(this.app, view, sourcePath) : null;
    if (selection && view) this.selectionViews.set(selection, view);
    return { activeNote, selection };
  }

  retainSelectionEmphasis(selection: NonNullable<ComposerContextReferences["selection"]>): EditorSelectionEmphasis | null {
    const view = this.selectionViews.get(selection);
    if (!view?.file || view.file.path !== selection.path) return null;
    if (!(this.app.vault.getAbstractFileByPath(view.file.path) instanceof TFile)) return null;
    if (view.editor.getRange(selection.range.from, selection.range.to) !== selection.text) return null;

    return retainEditorSelectionEmphasis(view.editor, selection.range);
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
