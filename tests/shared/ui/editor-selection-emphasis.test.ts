// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { editorSelectionEmphasisExtension, retainEditorSelectionEmphasis } from "../../../src/shared/ui/editor-selection-emphasis.obsidian";

describe("editor selection emphasis", () => {
  it("uses the host editor runtime and keeps independent retained ranges", () => {
    const { editor, parent, view } = emphasizedEditor();

    const range = { from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } };
    const releaseFirst = retainEditorSelectionEmphasis(editor as never, range);
    const releaseSecond = retainEditorSelectionEmphasis(editor as never, range);

    expect(parent.querySelectorAll(".codex-panel-selection-emphasis")).toHaveLength(1);
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

    view.destroy();
  });

  it("expires only candidates on actual selection changes and cannot revive them", () => {
    const { editor, parent, view } = emphasizedEditor();
    const candidate = retainEditorSelectionEmphasis(
      editor as never,
      {
        from: { line: 0, ch: 6 },
        to: { line: 0, ch: 10 },
      },
      { untilSelectionChanges: true },
    );
    const confirmed = retainEditorSelectionEmphasis(editor as never, {
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 5 },
    });
    view.dispatch({ selection: view.state.selection });
    expect([...parent.querySelectorAll(".codex-panel-selection-emphasis")].map((element) => element.textContent)).toEqual([
      "alpha",
      "beta",
    ]);
    view.dispatch({ selection: { anchor: 2 } });
    candidate?.setVisible(false);
    candidate?.setVisible(true);
    expect(parent.querySelector(".codex-panel-selection-emphasis")?.textContent).toBe("alpha");
    candidate?.release();
    confirmed?.release();
    view.destroy();
    parent.remove();
  });

  it("does not retain stale ranges after the document changes", () => {
    const { editor, parent, view } = emphasizedEditor();

    const release = retainEditorSelectionEmphasis(editor as never, {
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 5 },
    });
    view.dispatch({ changes: { from: 0, insert: "x" } });

    expect(parent.querySelector(".codex-panel-selection-emphasis")).toBeNull();

    release?.setVisible(false);
    release?.setVisible(true);
    release?.release();
    view.destroy();
  });

  it("fails closed when the extension is unavailable or the range is invalid", () => {
    const editor = {
      cm: new EditorView({ doc: "alpha" }),
      posToOffset: ({ ch }: { ch: number }) => ch,
    };

    expect(
      retainEditorSelectionEmphasis(editor as never, {
        from: { line: 0, ch: 0 },
        to: { line: 0, ch: 5 },
      }),
    ).toBeNull();

    editor.cm.destroy();
    editor.cm = new EditorView({ doc: "alpha", extensions: [editorSelectionEmphasisExtension] });
    expect(
      retainEditorSelectionEmphasis(editor as never, {
        from: { line: 0, ch: 5 },
        to: { line: 0, ch: 5 },
      }),
    ).toBeNull();
    editor.cm.destroy();
  });
});

function emphasizedEditor() {
  const editor = {
    cm: null as EditorView | null,
    posToOffset: ({ ch }: { ch: number }) => ch,
  };
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    doc: "alpha beta",
    extensions: [editorSelectionEmphasisExtension],
  });
  editor.cm = view;
  return { editor, parent, view };
}
