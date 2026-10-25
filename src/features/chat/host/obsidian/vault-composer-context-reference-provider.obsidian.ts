import type { App, EditorPosition, TAbstractFile } from "obsidian";
import { Component, MarkdownView, TFile } from "obsidian";
import { retainEditorSelectionEmphasis, type SelectionEmphasis } from "../../../../shared/ui/editor-selection-emphasis.obsidian";
import type {
  ActiveNoteContextReference,
  ComposerContextRange,
  ComposerContextReferenceProvider,
  ComposerContextReferences,
  ComposerSelectionEmphasis,
  SelectionContextReference,
} from "../../application/composer/context-references";
import { createLocalIdSource } from "../../application/local-id-source";
import { readingSelectionEmphases } from "./reading-selection-emphasis.dom";
import { displayNameForFile, linktextForFile } from "./vault-note-links.obsidian";

interface SelectionTarget {
  view: MarkdownView;
  file: TFile;
  path: string;
  root: HTMLElement;
  document: Document;
  mode: ReturnType<MarkdownView["getMode"]>;
}

interface ReadingSelection {
  text: string;
  id: string;
  range: Range | null;
}

interface PanelSelectionEmphasis {
  readonly decoration: SelectionEmphasis;
  enabled: boolean;
}

export class VaultComposerContextReferenceProvider implements ComposerContextReferenceProvider {
  private readonly shared: SharedComposerContext;
  private readonly selectionEmphases = new Set<PanelSelectionEmphasis>();
  private readonly lifecycle = new Component();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly isForeground: () => boolean,
  ) {
    this.lifecycle.load();
    this.lifecycle.registerEvent(
      app.workspace.on("active-leaf-change", () => {
        this.syncSelectionEmphasisVisibility();
      }),
    );
    const existing = sharedComposerContexts.get(app);
    if (existing) {
      existing.consumers.add(this);
      this.shared = existing;
      existing.tracker.syncCandidateVisibility();
      return;
    }
    const consumers = new Set([this]);
    this.shared = {
      tracker: new VaultComposerContextTracker(app, () => [...consumers].some((provider) => provider.isForeground())),
      consumers,
    };
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
    this.lifecycle.unload();
    for (const emphasis of this.selectionEmphases) emphasis.decoration.release();
    this.selectionEmphases.clear();
    this.shared.consumers.delete(this);
    this.shared.tracker.syncCandidateVisibility();
    if (this.shared.consumers.size > 0) return;
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
  readonly consumers: Set<VaultComposerContextReferenceProvider>;
}

const sharedComposerContexts = new WeakMap<App, SharedComposerContext>();

class VaultComposerContextTracker extends Component {
  private readonly selectionViews = new WeakMap<SelectionContextReference, MarkdownView>();
  private lastMarkdownView: MarkdownView | null = null;
  private readonly selectionIds = createLocalIdSource();
  private selectionTarget: SelectionTarget | null = null;
  private readingSelection: ReadingSelection | null = null;
  private selectionLifecycle: Component | null = null;
  private readingEmphases: ReturnType<typeof readingSelectionEmphases> | null = null;
  private candidateEmphasis: SelectionEmphasis | null = null;
  private readingObserver: MutationObserver | null = null;

  constructor(
    private readonly app: App,
    private readonly isPanelForeground: () => boolean,
  ) {
    super();
    this.load();
  }

  override onload(): void {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.refreshLastMarkdownView();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.refreshLastMarkdownView();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.syncSelectionTarget();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (_workspaceWindow, ownerWindow) => {
        if (this.selectionTarget?.document.defaultView === ownerWindow) {
          this.lastMarkdownView = null;
          this.syncSelectionTarget();
          return;
        }
        this.syncSelectionTarget();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (info.file === this.selectionTarget?.file) this.invalidateSelectionFile();
      }),
    );
    const invalidateFileSelection = (file: TAbstractFile): void => {
      if (file === this.selectionTarget?.file) this.invalidateSelectionFile();
    };
    this.registerEvent(this.app.vault.on("modify", invalidateFileSelection));
    this.registerEvent(this.app.vault.on("delete", invalidateFileSelection));
    this.registerEvent(this.app.vault.on("rename", invalidateFileSelection));
    this.refreshLastMarkdownView();
    this.captureReadingSelection(false);
    this.captureEditorCandidate();
  }

  syncCandidateVisibility(): void {
    const target = this.selectionTarget;
    const sourceFocused = target?.view.containerEl.contains(target.document.activeElement) ?? false;
    this.candidateEmphasis?.setVisible(this.isPanelForeground() && !sourceFocused);
  }

  contextReferences(sourcePath: string): ComposerContextReferences {
    this.syncSelectionTarget();
    this.refreshReadingEmphases();
    const view = this.validLastMarkdownView();
    const activeFile = view?.file ?? this.activeFile();
    const activeNote = activeFile
      ? {
          name: displayNameForFile(activeFile),
          path: activeFile.path,
          linktext: linktextForFile(this.app, activeFile, sourcePath || activeFile.path),
        }
      : null;
    const selection = view && activeNote ? selectionContextReference(view, activeNote, this.readingSelection) : null;
    if (selection?.range && view) this.selectionViews.set(selection, view);
    return { activeNote, selection };
  }

  retainSelectionEmphasis(selection: NonNullable<ComposerContextReferences["selection"]>): SelectionEmphasis | null {
    this.syncSelectionTarget();
    this.refreshReadingEmphases();
    if (selection.range === null) {
      const reading = this.readingSelection;
      if (reading?.id !== selection.selectionId || this.selectionTarget?.path !== selection.path || !reading.range) return null;
      const emphasis = this.readingEmphases?.retain(reading.range) ?? null;
      if (emphasis) this.releaseCandidateEmphasis();
      return emphasis;
    }
    const view = this.selectionViews.get(selection);
    if (!view?.file || view.file.path !== selection.path) return null;
    if (!(this.app.vault.getAbstractFileByPath(view.file.path) instanceof TFile)) return null;
    if (view.editor.getRange(selection.range.from, selection.range.to) !== selection.text) return null;

    const emphasis = retainEditorSelectionEmphasis(view.editor, selection.range);
    if (emphasis) this.releaseCandidateEmphasis();
    return emphasis;
  }

  dispose(): void {
    this.unload();
  }

  private refreshLastMarkdownView(): void {
    const view = this.activeMarkdownView();
    if (view?.file) this.lastMarkdownView = view;
    this.syncSelectionTarget();
    this.syncCandidateVisibility();
  }

  private syncSelectionTarget(): void {
    const view = this.validLastMarkdownView();
    const previous = this.selectionTarget;
    const root = view?.previewMode.containerEl;
    const file = view?.file;
    const attached = view?.containerEl.isConnected && this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view);
    if (
      previous &&
      attached &&
      previous.view === view &&
      previous.file === file &&
      previous.path === file.path &&
      previous.root === root &&
      previous.document === root.ownerDocument &&
      previous.mode === view.getMode() &&
      (previous.mode !== "preview" || root.isConnected)
    )
      return;

    this.clearSelectionCandidate();
    if (this.selectionLifecycle) this.removeChild(this.selectionLifecycle);
    this.selectionLifecycle = null;
    this.selectionTarget = null;
    this.readingEmphases = null;
    this.readingObserver = null;
    if (!view || !file || !root || !attached || (view.getMode() === "preview" && !root.isConnected)) return;

    const target: SelectionTarget = { view, file, path: file.path, root, document: root.ownerDocument, mode: view.getMode() };
    this.selectionTarget = target;
    const lifecycle = this.addChild(new Component());
    this.selectionLifecycle = lifecycle;
    lifecycle.register(() => {
      this.releaseCandidateEmphasis();
    });
    const emphases = readingSelectionEmphases(root);
    this.readingEmphases = emphases;
    lifecycle.register(() => {
      emphases.dispose();
    });
    lifecycle.registerDomEvent(target.document, "selectionchange", () => {
      if (!this.readingSelection || this.activeMarkdownView() !== view) return;
      const selection = target.document.getSelection();
      if (selection?.anchorNode && root.contains(selection.anchorNode) && selection.focusNode && root.contains(selection.focusNode)) {
        const activeElement = target.document.activeElement;
        this.captureReadingSelection(
          activeElement === target.document.body || (activeElement !== null && view.containerEl.contains(activeElement)),
        );
      }
    });
    lifecycle.registerDomEvent(
      target.document,
      "pointerdown",
      (event) => {
        const node = event.target;
        if (!node || !("nodeType" in node)) return;
        if (view.containerEl.contains(node as Node)) this.clearSelectionCandidate();
        else if (this.readingSelection) this.captureReadingSelection(false);
      },
      true,
    );
    lifecycle.registerDomEvent(root, "pointerup", () => {
      this.captureReadingSelection(true);
    });
    lifecycle.registerDomEvent(
      root,
      "keydown",
      (event) => {
        if (event.key === "Escape") this.clearSelectionCandidate();
        else if (this.readingSelection) this.captureReadingSelection(false);
      },
      true,
    );
    lifecycle.registerDomEvent(root, "keyup", (event) => {
      const navigation = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key);
      const selecting = (navigation && event.shiftKey) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a");
      if (selecting || (navigation && this.readingSelection !== null)) {
        if (selecting && this.readingSelection?.range === null) this.clearSelectionCandidate();
        this.captureReadingSelection(true);
      }
    });
    lifecycle.registerDomEvent(view.containerEl, "focusin", () => {
      this.releaseCandidateEmphasis();
    });
    lifecycle.registerDomEvent(
      view.containerEl,
      "focusout",
      (event) => {
        if (event.relatedTarget && "nodeType" in event.relatedTarget && view.containerEl.contains(event.relatedTarget as Node)) return;
        if (this.readingSelection) this.captureReadingSelection(false);
        const range = this.readingSelection?.range;
        if (range && !this.candidateEmphasis) this.candidateEmphasis = this.readingEmphases?.retain(range) ?? null;
        this.captureEditorCandidate();
        this.syncCandidateVisibility();
      },
      true,
    );
    // Public workspace events do not specify a mode-change notification. Revalidate
    // this view on DOM changes without treating ordinary preview rendering as expiry.
    const viewWindow = target.document.defaultView;
    if (!viewWindow) return;
    const observer = new viewWindow.MutationObserver((mutations) => {
      this.refreshReadingEmphases(mutations);
      this.syncSelectionTarget();
    });
    observer.observe(view.containerEl, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    this.readingObserver = observer;
    lifecycle.register(() => {
      observer.disconnect();
    });
  }

  private captureReadingSelection(clearEmpty: boolean): void {
    this.syncSelectionTarget();
    const target = this.selectionTarget;
    if (target?.mode !== "preview") return;
    this.refreshReadingEmphases();
    const text = readingSelectionText(target.root);
    if (text === null) {
      if (clearEmpty) this.clearSelectionCandidate();
      return;
    }
    const previous = this.readingSelection;
    if (previous?.text === text) return;
    this.clearSelectionCandidate();
    const range = target.document.getSelection()?.getRangeAt(0).cloneRange() ?? null;
    this.readingSelection = { text, id: this.selectionIds.next("selection"), range };
    this.candidateEmphasis = range ? (this.readingEmphases?.retain(range) ?? null) : null;
    this.syncCandidateVisibility();
  }

  private captureEditorCandidate(): void {
    this.syncSelectionTarget();
    const target = this.selectionTarget;
    if (!target || target.mode === "preview") return;
    this.releaseCandidateEmphasis();
    const editor = target.view.editor;
    if (!editor.getSelection().trim()) return;
    this.candidateEmphasis = retainEditorSelectionEmphasis(editor, editorSelectionRange(editor.getCursor("from"), editor.getCursor("to")), {
      untilSelectionChanges: true,
    });
    this.syncCandidateVisibility();
  }

  private releaseCandidateEmphasis(): void {
    this.candidateEmphasis?.release();
    this.candidateEmphasis = null;
  }

  private clearSelectionCandidate(): void {
    this.releaseCandidateEmphasis();
    this.readingSelection = null;
  }

  private invalidateSelectionFile(): void {
    this.clearSelectionCandidate();
    this.readingEmphases?.clear();
  }

  private refreshReadingEmphases(mutations = this.readingObserver?.takeRecords() ?? []): void {
    const root = this.selectionTarget?.root;
    if (!root || !mutations.some((mutation) => mutation.type !== "attributes" && root.contains(mutation.target))) return;
    this.readingEmphases?.clear();
    if (this.readingSelection) this.readingSelection.range = null;
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

function readingSelectionText(root: HTMLElement): string | null {
  const selection = root.ownerDocument.getSelection();
  if (selection?.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = selection.toString();
  return text.trim() ? text : null;
}

function selectionContextReference(
  view: MarkdownView,
  note: ActiveNoteContextReference,
  reading: ReadingSelection | null,
): ComposerContextReferences["selection"] {
  if (view.getMode() === "preview") {
    return reading ? { ...note, range: null, text: reading.text, selectionId: reading.id } : null;
  }
  const text = view.editor.getSelection();
  if (!text.trim()) return null;
  return {
    ...note,
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
