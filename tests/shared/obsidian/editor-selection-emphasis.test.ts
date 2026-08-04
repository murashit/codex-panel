// @vitest-environment jsdom

import { type Extension, StateEffect } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  registerEditorSelectionEmphasis,
  retainEditorSelectionEmphasis,
} from "../../../src/shared/obsidian/editor-selection-emphasis.obsidian";

describe("editor selection emphasis", () => {
  it("uses the host editor runtime and keeps independent retained ranges", () => {
    const editor = {
      cm: null as EditorView | null,
      posToOffset: ({ ch }: { ch: number }) => ch,
    };
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      doc: "alpha beta",
      extensions: [EditorView.decorations.of(Decoration.set([Decoration.mark({ class: "seed" }).range(6, 10)]))],
    });
    editor.cm = view;
    let reset = (): void => undefined;
    registerEditorSelectionEmphasis({
      register: (cleanup: () => void) => {
        reset = cleanup;
      },
      registerEditorExtension: (extension: Extension) => {
        view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
      },
    } as never);

    const range = { from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } };
    const releaseFirst = retainEditorSelectionEmphasis(editor as never, range);
    const releaseSecond = retainEditorSelectionEmphasis(editor as never, range);

    expect(parent.querySelector(".codex-panel-selection-emphasis")?.textContent).toBe("alpha");

    releaseFirst?.setVisible(false);
    expect(parent.querySelector(".codex-panel-selection-emphasis")?.textContent).toBe("alpha");

    releaseSecond?.setVisible(false);
    expect(parent.querySelector(".codex-panel-selection-emphasis")).toBeNull();

    releaseFirst?.setVisible(true);
    expect(parent.querySelector(".codex-panel-selection-emphasis")?.textContent).toBe("alpha");

    releaseFirst?.release();
    releaseFirst?.release();
    releaseFirst?.setVisible(true);
    expect(parent.querySelector(".codex-panel-selection-emphasis")).toBeNull();

    releaseSecond?.release();
    releaseSecond?.release();
    expect(parent.querySelector(".codex-panel-selection-emphasis")).toBeNull();

    reset();
    view.destroy();
  });

  it("does not retain stale ranges after the document changes", () => {
    const editor = {
      cm: null as EditorView | null,
      posToOffset: ({ ch }: { ch: number }) => ch,
    };
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      doc: "alpha beta",
      extensions: [EditorView.decorations.of(Decoration.set([Decoration.mark({ class: "seed" }).range(6, 10)]))],
    });
    editor.cm = view;
    let reset = (): void => undefined;
    registerEditorSelectionEmphasis({
      register: (cleanup: () => void) => {
        reset = cleanup;
      },
      registerEditorExtension: (extension: Extension) => {
        view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
      },
    } as never);

    const release = retainEditorSelectionEmphasis(editor as never, {
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 5 },
    });
    view.dispatch({ changes: { from: 0, insert: "x" } });

    expect(parent.querySelector(".codex-panel-selection-emphasis")).toBeNull();

    release?.setVisible(false);
    release?.setVisible(true);
    release?.release();
    reset();
    view.destroy();
  });
});
