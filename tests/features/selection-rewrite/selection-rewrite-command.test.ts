// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { type Command, type Editor, type EditorPosition, MarkdownView, Plugin, TFile } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerSelectionRewriteCommand } from "../../../src/features/selection-rewrite/command.obsidian";
import type { SelectionRewritePort } from "../../../src/features/selection-rewrite/port";
import { editorSelectionEmphasisExtension } from "../../../src/shared/ui/editor-selection-emphasis.obsidian";
import { deferred } from "../../support/async";
import { changeInputValue, installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();
const cleanups: Array<() => void> = [];
afterEach(() => {
  void act(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("selection rewrite command", () => {
  it.each(["forward", "backward"])(
    "captures the later multiline Unicode selection from a %s selection and applies only there",
    async (direction) => {
      const selected = "選択😀\n次の行";
      const prefix = `${selected}\nEARLY CONTEXT\n${"filler\n".repeat(4_000)}LATER CONTEXT\n😀 `;
      const suffix = "\nUnsaved paragraph.";
      const result = deferred<{ replacementText: string }>();
      const generate = vi.fn<SelectionRewritePort["generate"]>(() => result.promise);
      const { run, cm } = commandHarness({
        noteText: prefix + selected + suffix,
        anchor: direction === "forward" ? prefix.length : prefix.length + selected.length,
        head: direction === "forward" ? prefix.length + selected.length : prefix.length,
        generate,
      });

      expect(run(true)).toBe(true);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      void act(() => {
        expect(run()).toBe(true);
      });
      cm.dispatch({
        changes: { from: cm.state.doc.length, insert: "\nLIVE-ONLY TEXT" },
        selection: { anchor: 0, head: selected.length },
      });
      await startGeneration();

      expect(generate).toHaveBeenCalledOnce();
      const request = generate.mock.calls[0]?.[0];
      expect(request?.prompt).toContain("- File: Draft.md");
      expect(request?.prompt).toContain(`Selected text:\n\`\`\`text\n${selected}\n\`\`\``);
      const context = request?.prompt.match(/Current note context:\n```text\n([\s\S]*?)\n```\n\nReminder:/u)?.[1];
      expect(context).toContain(`LATER CONTEXT\n😀 ${selected}\nUnsaved paragraph.`);
      expect(context).not.toContain("EARLY CONTEXT");
      expect(context).not.toContain("LIVE-ONLY TEXT");
      expect(context?.length).toBeLessThanOrEqual(20_000);

      await act(async () => {
        result.resolve({ replacementText: "短くした文。" });
      });
      expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("短くした文。");
      void act(() => button("Apply").click());

      expect(cm.state.doc.toString()).toBe(`${prefix}短くした文。${suffix}\nLIVE-ONLY TEXT`);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it("protects pending edits and recovers after reselecting text and reopening Rewrite selection", async () => {
    const result = deferred<{ replacementText: string }>();
    const generate = vi
      .fn<SelectionRewritePort["generate"]>()
      .mockImplementationOnce(() => result.promise)
      .mockResolvedValueOnce({ replacementText: "Recovered rewrite." });
    const { run, cm, editor } = commandHarness({ generate });
    void act(() => {
      run();
    });
    await startGeneration();
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: "Edited this sentence." } });
    await act(async () => {
      result.resolve({ replacementText: "Rewritten sentence." });
    });
    void act(() => button("Apply").click());

    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(cm.state.doc.toString()).toBe("Edited this sentence.");
    expect(document.querySelector(".codex-panel-selection-rewrite__status")?.textContent).toMatch(
      /select the text again.*reopen Rewrite selection/i,
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
    void act(() => {
      run();
    });
    await startGeneration();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0].prompt).toContain("Selected text:\n```text\nEdited this sentence.\n```");
    void act(() => button("Apply").click());

    expect(cm.state.doc.toString()).toBe("Recovered rewrite.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("replaces the previous popover and releases selection emphasis on close and unload", () => {
    const { run, controller, lifetime } = commandHarness();
    void act(() => {
      run();
    });
    const first = document.querySelector('[role="dialog"]');
    expect(document.querySelector(".codex-panel-selection-emphasis")?.textContent).toBe("Revise this sentence.");

    void act(() => {
      run();
    });
    expect(first?.isConnected).toBe(false);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll(".codex-panel-selection-emphasis")).toHaveLength(1);

    void act(() => controller.closeAll());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".codex-panel-selection-emphasis")).toBeNull();

    void act(() => {
      run();
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    void act(() => lifetime.unload());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".codex-panel-selection-emphasis")).toBeNull();
    lifetime.unload();
  });

  it("keeps the command unavailable without a non-empty markdown selection", () => {
    const { run, editor, view } = commandHarness();
    editor.getSelection.mockReturnValue("   ");
    expect(run(true)).toBe(false);
    editor.getSelection.mockReturnValue("Rewrite me");
    expect(run(true, {} as MarkdownView)).toBe(false);
    view.file = null;
    expect(run(true)).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

function commandHarness(options: { noteText?: string; anchor?: number; head?: number; generate?: SelectionRewritePort["generate"] } = {}) {
  const noteText = options.noteText ?? "Revise this sentence.";
  const cm = new EditorView({
    parent: document.body,
    doc: noteText,
    selection: { anchor: options.anchor ?? 0, head: options.head ?? noteText.length },
    extensions: [editorSelectionEmphasisExtension],
  });
  // jsdom does not measure CodeMirror's DOM selection geometry.
  vi.spyOn(cm, "coordsAtPos").mockReturnValue(new DOMRect(100, 100, 20, 20));
  const posToOffset = (position: EditorPosition): number => cm.state.doc.line(position.line + 1).from + position.ch;
  const editor = {
    cm,
    posToOffset,
    getCursor: (side: "from" | "to" | "head" | "anchor" = "head") => {
      const offset = cm.state.selection.main[side];
      const line = cm.state.doc.lineAt(offset);
      return { line: line.number - 1, ch: offset - line.from };
    },
    getSelection: vi.fn(() => cm.state.sliceDoc(cm.state.selection.main.from, cm.state.selection.main.to)),
    getValue: () => cm.state.doc.toString(),
    getRange: (from: EditorPosition, to: EditorPosition) => cm.state.sliceDoc(posToOffset(from), posToOffset(to)),
    replaceRange: vi.fn((replacement: string, from: EditorPosition, to: EditorPosition) => {
      cm.dispatch({ changes: { from: posToOffset(from), to: posToOffset(to), insert: replacement } });
    }),
  };
  const lifetime = new (class extends Plugin {})({} as never, {} as never);
  lifetime.load();
  let callback: Command["editorCheckCallback"];
  const plugin = {
    settings: { sendShortcut: "enter", rewriteSelectionModel: null, rewriteSelectionEffort: null },
    register: (cleanup: () => void) => lifetime.register(cleanup),
    addCommand: (command: Command) => {
      callback = command.editorCheckCallback;
    },
  };
  const view = new MarkdownView({} as never);
  Object.assign(view, { containerEl: document.createElement("div") });
  view.file = Object.assign(new TFile(), { path: "Draft.md", basename: "Draft" });
  const controller = registerSelectionRewriteCommand(plugin as never, {
    generate: options.generate ?? (async () => ({ replacementText: "Rewritten sentence." })),
  });
  cleanups.push(() => {
    lifetime.unload();
    cm.destroy();
  });
  return {
    cm,
    editor,
    view,
    controller,
    lifetime,
    run: (checking = false, targetView = view) => callback?.(checking, editor as unknown as Editor, targetView),
  };
}

async function startGeneration(): Promise<void> {
  await act(async () => {
    const instruction = document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction");
    if (!instruction) throw new Error("Missing rewrite instruction");
    changeInputValue(instruction, "Make it concise.");
  });
  await act(async () => {
    button("Generate").click();
  });
}

function button(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing ${label} button`);
  return element;
}
