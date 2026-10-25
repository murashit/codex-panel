// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import type { App, EventRef, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultComposerContextReferenceProvider } from "../../../../../src/features/chat/host/obsidian/vault-composer-context-reference-provider.obsidian";
import { editorSelectionEmphasisExtension } from "../../../../../src/shared/ui/editor-selection-emphasis.obsidian";
import { markdownFileFixture } from "../../../../support/vault-file";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Composer selection context", () => {
  it("shows the transient selection after Panel focus before completion", () => {
    const highlights = installHighlights(document);
    const fixture = readingFixture();
    fixture.select("not yet inserted");
    fixture.setActive(null);
    fixture.panel.focus();
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    fixture.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
  });

  it("limits candidates to foreground Panels and hands off without query or focus-switch revival", () => {
    const highlights = installHighlights(document);
    const fixture = readingFixture();
    fixture.select("candidate and next candidate");
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    let secondForeground = true;
    const second = new VaultComposerContextReferenceProvider(fixture.app, () => secondForeground);
    cleanups.push(() => second.dispose());
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    secondForeground = false;
    fixture.setActive(null);
    fixture.panel.focus();
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    fixture.setOtherView();
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    fixture.setActive(null);
    second.dispose();
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    const retained = fixture.provider.retainSelectionEmphasis(fixture.provider.contextReferences("").selection);
    retained?.setEnabled(false);
    fixture.provider.contextReferences("");
    fixture.setActive(fixture.view);
    fixture.setActive(null);
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    retained?.setEnabled(true);
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    retained?.setEnabled(false);
    fixture.setActive(fixture.view);
    fixture.root.focus();
    fixture.root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const textNode = fixture.root.firstChild;
    if (!textNode) throw new Error("Missing selected text");
    const nextRange = document.createRange();
    nextRange.setStart(textNode, 14);
    nextRange.setEnd(textNode, 28);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(nextRange);
    fixture.root.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    fixture.panel.focus();
    fixture.setActive(null);
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    retained?.setEnabled(true);
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(2);
    retained?.release();
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    fixture.setActive(fixture.view);
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
  });

  it("shows editor candidates on leaving the document and keeps confirmed emphasis independent", () => {
    const fixture = editorFixture();
    const painting = () =>
      [...fixture.view.containerEl.querySelectorAll(".codex-panel-selection-emphasis")].map((element) => element.textContent);
    fixture.cm.contentDOM.focus();
    fixture.cm.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(painting()).toEqual([]);
    fixture.panel.focus();
    expect(painting()).toEqual([]);
    fixture.setActive(null);
    expect(painting()).toEqual(["alpha"]);
    const confirmed = fixture.provider.retainSelectionEmphasis(fixture.provider.contextReferences("").selection);
    expect(painting()).toEqual(["alpha"]);
    confirmed?.setEnabled(false);
    fixture.provider.contextReferences("");
    fixture.setActive(fixture.view);
    fixture.setActive(null);
    expect(painting()).toEqual([]);
    confirmed?.setEnabled(true);
    expect(painting()).toEqual(["alpha"]);
    fixture.setActive(fixture.view);
    fixture.cm.contentDOM.focus();
    expect(painting()).toEqual([]);
    fixture.cm.dispatch({ selection: { anchor: 6, head: 10 } });
    fixture.panel.focus();
    fixture.setActive(null);
    expect(painting()).toEqual(["alpha", "beta"]);
    fixture.cm.dispatch({ selection: { anchor: 0 } });
    expect(painting()).toEqual(["alpha"]);
    confirmed?.release();
    fixture.setActive(fixture.view);
    fixture.cm.contentDOM.focus();
    fixture.cm.dispatch({ selection: { anchor: 0, head: 5 } });
    fixture.panel.focus();
    fixture.setActive(null);
    expect(painting()).toEqual(["alpha"]);
    fixture.cm.dispatch({ changes: { from: 0, insert: "x" } });
    fixture.setActive(fixture.view);
    fixture.setActive(null);
    expect(painting()).toEqual([]);
  });

  it("revalidates a mode change during focusout before using the cached Reading range", () => {
    const fixture = editorFixture();
    fixture.setMode("preview");
    fixture.provider.contextReferences("");
    fixture.root.focus();
    fixture.select("Reading before mode change");
    fixture.setMode("source");
    fixture.panel.focus();
    fixture.setActive(null);
    expect(fixture.provider.contextReferences("").selection).toBeNull();
    expect(fixture.view.containerEl.querySelector(".codex-panel-selection-emphasis")).toBeNull();
  });

  it("captures the existing editor selection when the first Panel provider starts", () => {
    const fixture = editorFixture();
    fixture.cm.contentDOM.focus();
    fixture.cm.dispatch({ selection: { anchor: 6, head: 10 } });
    fixture.provider.dispose();
    expect(fixture.view.containerEl.querySelector(".codex-panel-selection-emphasis")).toBeNull();
    fixture.panel.focus();
    let foreground = false;
    const provider = new VaultComposerContextReferenceProvider(fixture.app, () => foreground);
    cleanups.push(() => provider.dispose());
    expect(fixture.view.containerEl.querySelector(".codex-panel-selection-emphasis")).toBeNull();
    foreground = true;
    fixture.setActive(null);
    expect(fixture.view.containerEl.querySelector(".codex-panel-selection-emphasis")?.textContent).toBe("beta");
  });

  it.each(["mode", "file", "detach", "window-close", "dispose"])("drops an editor candidate on %s without recreation", (change) => {
    const fixture = editorFixture();
    fixture.cm.contentDOM.focus();
    fixture.cm.dispatch({ selection: { anchor: 0, head: 5 } });
    fixture.panel.focus();
    fixture.setActive(null);
    expect(fixture.view.containerEl.querySelector(".codex-panel-selection-emphasis")).not.toBeNull();
    if (change === "mode") fixture.setMode("preview");
    if (change === "file") fixture.view.file = markdownFileFixture("Beta.md");
    if (change === "detach") fixture.view.containerEl.remove();
    if (change === "window-close") fixture.emit("window-close", {}, document.defaultView);
    if (change === "dispose") fixture.provider.dispose();
    if (change !== "dispose") fixture.provider.contextReferences("");
    if (change === "window-close" || change === "dispose") {
      fixture.cm.contentDOM.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: fixture.panel }));
    }
    expect(fixture.view.containerEl.querySelector(".codex-panel-selection-emphasis")).toBeNull();
  });

  it("keeps candidate and confirmed highlights without changing DOM, focus, or native selection", () => {
    const highlights = installHighlights(document);
    const fixture = readingFixture();
    fixture.select("selected text");
    const reference = fixture.provider.contextReferences("").selection;
    if (!reference) throw new Error("Missing selection");
    const originalHTML = fixture.root.innerHTML;
    const originalRange = document.getSelection()?.getRangeAt(0);
    const activeElement = document.activeElement;
    fixture.setActive(null);
    const retained = fixture.provider.retainSelectionEmphasis(reference);
    expect(retained).not.toBeNull();
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    expect(fixture.root.innerHTML).toBe(originalHTML);
    expect(document.activeElement).toBe(activeElement);
    expect(document.getSelection()?.getRangeAt(0)).toBe(originalRange);

    fixture.setActive(null);
    fixture.panel.focus();
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);

    retained?.setEnabled(false);
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    retained?.setEnabled(true);
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    fixture.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    retained?.release();
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
  });

  it.each(["text", "children"])("drops painting on %s rendering changes but keeps captured text", async (change) => {
    const highlights = installHighlights(document);
    const fixture = readingFixture();
    fixture.select("original text");
    const reference = fixture.provider.contextReferences("").selection;
    fixture.setActive(null);
    const retained = fixture.provider.retainSelectionEmphasis(reference);
    fixture.view.containerEl.classList.add("focused");
    await Promise.resolve();
    expect(highlights.has("codex-panel-reading-selection")).toBe(true);

    if (change === "text" && fixture.root.firstChild) fixture.root.firstChild.textContent = "changed text";
    else fixture.root.textContent = "new rendered content";
    // A send/completion can run before the MutationObserver callback.
    expect(fixture.provider.contextReferences("").selection).toEqual(reference);
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    expect(fixture.provider.retainSelectionEmphasis(reference)).toBeNull();
    retained?.setEnabled(false);
    retained?.setEnabled(true);
    await Promise.resolve();
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    expect(reference?.text).toBe("original text");
  });

  it("requires a fresh selection gesture to repaint identical text after rendering", () => {
    const highlights = installHighlights(document);
    const fixture = readingFixture();
    fixture.select("same displayed text");
    const original = fixture.provider.contextReferences("").selection;
    fixture.root.textContent = "same displayed text";
    fixture.provider.contextReferences("");
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    selectNodeText(fixture.root);
    fixture.panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    fixture.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a", ctrlKey: true }));
    fixture.setActive(null);
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    expect(fixture.provider.contextReferences("").selection).toMatchObject({ text: "same displayed text", range: null });
    expect(fixture.provider.contextReferences("").selection).not.toEqual(original);
  });

  it.each(["modify", "mode", "detach", "window-close", "dispose"])("cleans only its own painting on %s", async (change) => {
    const highlights = installHighlights(document);
    const foreign = new Set<Range>();
    highlights.set("another-plugin", foreign);
    const fixture = readingFixture();
    fixture.select("selected");
    const retained = fixture.provider.retainSelectionEmphasis(fixture.provider.contextReferences("").selection);
    if (change === "modify") fixture.emit("modify", fixture.view.file);
    if (change === "mode") {
      fixture.getEditorSelection.mockReturnValue("");
      fixture.setMode("source");
    }
    if (change === "detach") fixture.view.containerEl.remove();
    if (change === "window-close") fixture.emit("window-close", {}, document.defaultView);
    if (change === "dispose") fixture.provider.dispose();
    if (change !== "dispose") fixture.provider.contextReferences("");
    await Promise.resolve();
    retained?.setEnabled(true);
    retained?.release();
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    expect(highlights.get("another-plugin")).toBe(foreign);
  });

  it("uses the owner window's highlight support and existing Panel foreground control", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    cleanups.push(() => frame.remove());
    const ownerDocument = frame.contentDocument;
    if (!ownerDocument) throw new Error("Missing document");
    const highlights = installHighlights(ownerDocument);
    const fixture = readingFixture(ownerDocument);
    fixture.select("popout quote");
    const reference = fixture.provider.contextReferences("").selection;
    let foreground = false;
    const second = new VaultComposerContextReferenceProvider(fixture.app, () => foreground);
    cleanups.push(() => second.dispose());
    const retained = second.retainSelectionEmphasis(reference);
    expect(retained).not.toBeNull();
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    foreground = true;
    fixture.setActive(null);
    expect(highlights.get("codex-panel-reading-selection")?.size).toBe(1);
    foreground = false;
    fixture.setActive(fixture.view);
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    fixture.provider.dispose();
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
    second.dispose();
    expect(highlights.has("codex-panel-reading-selection")).toBe(false);
  });

  it("retains an immutable capture across Panel focus without consulting the hidden editor", () => {
    const fixture = readingFixture();
    fixture.select("Alpha displayed text");
    const first = fixture.provider.contextReferences("").selection;
    expect(first).toMatchObject({ range: null, text: "Alpha displayed text", path: "Alpha.md" });
    expect(fixture.provider.contextReferences("").selection).toEqual(first);

    fixture.panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fixture.setActive(null);
    fixture.panel.focus();
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(fixture.provider.contextReferences("").selection).toEqual(first);

    fixture.setActive(fixture.view);
    fixture.select("Beta displayed text");
    const second = fixture.provider.contextReferences("").selection;
    expect(second).toMatchObject({ range: null, text: "Beta displayed text" });
    if (first?.range !== null || second?.range !== null) throw new Error("Expected Reading references");
    expect(second.selectionId).not.toBe(first.selectionId);
    expect(first.text).toBe("Alpha displayed text");
    expect(fixture.provider.retainSelectionEmphasis(first)).toBeNull();
    expect(fixture.getEditorSelection).not.toHaveBeenCalled();
  });

  it("expires on explicit deselection and ignores Panel and crossing selections", () => {
    const fixture = readingFixture();
    fixture.select("selected");
    fixture.root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.getSelection()?.removeAllRanges();
    fixture.root.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(fixture.provider.contextReferences("").selection).toBeNull();

    fixture.select("   ");
    expect(fixture.provider.contextReferences("").selection).toBeNull();
    fixture.select("valid");
    const captured = fixture.provider.contextReferences("").selection;
    fixture.setActive(null);
    fixture.panel.textContent = "Panel text";
    selectNodeText(fixture.panel);
    document.dispatchEvent(new Event("selectionchange"));
    expect(fixture.provider.contextReferences("").selection).toEqual(captured);

    fixture.setActive(fixture.view);
    fixture.root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const range = document.createRange();
    range.setStart(fixture.root, 0);
    range.setEnd(fixture.panel, 1);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    fixture.root.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(fixture.provider.contextReferences("").selection).toBeNull();
  });

  it.each(["modify", "delete", "rename", "editor-change"])(
    "invalidates on %s without reviving the old native selection on Panel click",
    (event) => {
      const fixture = readingFixture();
      fixture.select("before change");
      if (event === "editor-change") fixture.emit(event, {}, fixture.view);
      else fixture.emit(event, fixture.view.file);
      fixture.root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "p", metaKey: true }));
      fixture.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));
      fixture.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowDown" }));
      document.dispatchEvent(new Event("selectionchange"));
      fixture.panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(fixture.provider.contextReferences("").selection).toBeNull();
    },
  );

  it("invalidates mode round trips through view mutations, while ordinary rendering preserves the capture", async () => {
    const fixture = readingFixture();
    fixture.select("before mode change");
    const captured = fixture.provider.contextReferences("").selection;
    fixture.root.append(document.createElement("span"));
    await Promise.resolve();
    expect(fixture.provider.contextReferences("").selection).toEqual(captured);

    fixture.setMode("source");
    fixture.view.containerEl.classList.add("source-mode");
    await Promise.resolve();
    fixture.setMode("preview");
    fixture.view.containerEl.classList.remove("source-mode");
    await Promise.resolve();
    expect(fixture.provider.contextReferences("").selection).toBeNull();
  });

  it.each(["file", "root", "detach"])("invalidates a captured selection on %s change", (change) => {
    const fixture = readingFixture();
    fixture.select("captured text");
    if (change === "file") {
      fixture.view.file = markdownFileFixture("Beta.md");
      fixture.emit("file-open", fixture.view.file);
    } else if (change === "root") {
      fixture.view.previewMode.containerEl = document.createElement("div");
      fixture.view.containerEl.append(fixture.view.previewMode.containerEl);
    } else {
      fixture.view.containerEl.remove();
    }
    expect(fixture.provider.contextReferences("").selection).toBeNull();
  });

  it("recovers only on a fresh selection gesture after invalidation", () => {
    const fixture = readingFixture();
    fixture.select("old selection");
    fixture.emit("modify", fixture.view.file);
    fixture.root.textContent = "keyboard selection";
    selectNodeText(fixture.root);
    fixture.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight", shiftKey: true }));
    expect(fixture.provider.contextReferences("").selection?.text).toBe("keyboard selection");
    fixture.emit("modify", fixture.view.file);
    fixture.select("fresh pointer selection");
    expect(fixture.provider.contextReferences("").selection?.text).toBe("fresh pointer selection");
  });

  it("clears an existing candidate when a new keyboard selection crosses the preview boundary", () => {
    const fixture = readingFixture();
    fixture.select("old selection");
    const range = document.createRange();
    range.setStart(fixture.root, 0);
    range.setEndAfter(fixture.panel);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    fixture.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a", ctrlKey: true }));
    expect(fixture.provider.contextReferences("").selection).toBeNull();
  });

  it("uses the originating document and removes its listeners when the last consumer closes", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    cleanups.push(() => frame.remove());
    const ownerDocument = frame.contentDocument;
    if (!ownerDocument) throw new Error("Missing iframe document");
    const fixture = readingFixture(ownerDocument);
    fixture.select("popout document text");
    expect(fixture.provider.contextReferences("").selection?.text).toBe("popout document text");
    const second = new VaultComposerContextReferenceProvider(fixture.app, () => false);
    cleanups.push(() => second.dispose());
    fixture.provider.dispose();
    fixture.select("still tracked");
    expect(second.contextReferences("").selection?.text).toBe("still tracked");
    const remove = vi.spyOn(ownerDocument, "removeEventListener");
    second.dispose();
    expect(remove).toHaveBeenCalledWith("selectionchange", expect.any(Function), undefined);
  });
});

function readingFixture(ownerDocument = document) {
  const root = ownerDocument.createElement("div");
  const containerEl = ownerDocument.createElement("div");
  containerEl.append(root);
  root.tabIndex = 0;
  const panel = ownerDocument.createElement("textarea");
  ownerDocument.body.append(containerEl, panel);
  cleanups.push(() => {
    containerEl.remove();
    panel.remove();
  });
  let mode: "source" | "preview" = "preview";
  const getEditorSelection = vi.fn(() => "stale editor selection");
  const view = {
    file: markdownFileFixture("Alpha.md"),
    containerEl,
    previewMode: { containerEl: root },
    getMode: () => mode,
    editor: { getSelection: getEditorSelection },
  };
  let active: typeof view | null = view;
  let panelForeground = false;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = (name: string, callback: (...args: unknown[]) => void): EventRef => {
    const callbacks = listeners.get(name) ?? new Set();
    callbacks.add(callback);
    listeners.set(name, callbacks);
    return { __obsidianMockCleanup: () => callbacks.delete(callback) } as unknown as EventRef;
  };
  const emit = (name: string, ...args: unknown[]): void => {
    for (const callback of [...(listeners.get(name) ?? [])]) callback(...args);
  };
  const app = {
    workspace: { on, getActiveViewOfType: () => active, getActiveFile: () => view.file, getLeavesOfType: () => [{ view }] },
    vault: { on, getAbstractFileByPath: (path: string) => (view.file.path === path ? view.file : null) },
    metadataCache: { fileToLinktext: (file: TFile) => file.basename },
  } as unknown as App;
  const provider = new VaultComposerContextReferenceProvider(app, () => panelForeground);
  cleanups.push(() => provider.dispose());
  return {
    app,
    view,
    root,
    panel,
    provider,
    emit,
    getEditorSelection,
    setActive: (value: typeof view | null) => {
      active = value;
      panelForeground = value === null;
      emit("active-leaf-change");
    },
    setOtherView: () => {
      active = null;
      panelForeground = false;
      emit("active-leaf-change");
    },
    setMode: (value: typeof mode) => {
      mode = value;
    },
    select: (text: string) => {
      root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      root.textContent = text;
      selectNodeText(root);
      root.dispatchEvent(new Event("pointerup", { bubbles: true }));
    },
  };
}

function editorFixture() {
  const fixture = readingFixture();
  fixture.setMode("source");
  const cm = new EditorView({ parent: fixture.view.containerEl, doc: "alpha beta", extensions: [editorSelectionEmphasisExtension] });
  fixture.getEditorSelection.mockImplementation(() => cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to));
  Object.assign(fixture.view.editor, {
    cm,
    getCursor: (side: "from" | "to") => ({ line: 0, ch: cm.state.selection.main[side] }),
    posToOffset: ({ ch }: { ch: number }) => ch,
    getRange: (from: { ch: number }, to: { ch: number }) => cm.state.sliceDoc(from.ch, to.ch),
  });
  fixture.provider.contextReferences("");
  cleanups.push(() => {
    fixture.provider.dispose();
    cm.destroy();
  });
  return { ...fixture, cm };
}

function selectNodeText(node: HTMLElement): void {
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  const selection = node.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// jsdom does not paint CSS highlights; double only that browser registry boundary.
// DOM Range, selection, focus, events, and mutation delivery remain real.
function installHighlights(ownerDocument: Document): Map<string, Set<Range>> {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) throw new Error("Missing owner window");
  const registry = new Map<string, Set<Range>>();
  for (const [name, value] of [
    ["CSS", { highlights: registry }],
    ["Highlight", Set],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(ownerWindow, name);
    Object.defineProperty(ownerWindow, name, { configurable: true, value });
    cleanups.push(() => {
      if (original) Object.defineProperty(ownerWindow, name, original);
      else Reflect.deleteProperty(ownerWindow, name);
    });
  }
  return registry;
}
