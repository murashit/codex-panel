// @vitest-environment jsdom

import { MarkdownView, Plugin, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { registerSelectionRewriteCommand } from "../../../src/features/selection-rewrite/command.obsidian";
import type { SelectionRewritePopoverOptions } from "../../../src/features/selection-rewrite/popover.dom";
import type { SelectionRewritePort } from "../../../src/features/selection-rewrite/port";

const popoverMock = vi.hoisted(() => {
  const instances: { options: SelectionRewritePopoverOptions; open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  return {
    instances,
    reset(): void {
      instances.length = 0;
    },
  };
});
const selectionEmphasisMock = vi.hoisted(() => ({
  release: vi.fn(),
  retain: vi.fn(),
  setVisible: vi.fn(),
}));

vi.mock("../../../src/shared/obsidian/editor-selection-emphasis.obsidian", () => ({
  retainEditorSelectionEmphasis: selectionEmphasisMock.retain,
}));

vi.mock("../../../src/features/selection-rewrite/popover.dom", () => {
  class SelectionRewritePopover {
    readonly open = vi.fn();
    readonly close = vi.fn(() => {
      this.options.onClose?.();
    });

    constructor(readonly options: SelectionRewritePopoverOptions) {
      popoverMock.instances.push({ options, open: this.open, close: this.close });
    }
  }

  return { SelectionRewritePopover };
});

describe("selection rewrite command", () => {
  it("captures the unsaved editor buffer and clones the target range", () => {
    popoverMock.reset();
    selectionEmphasisMock.release.mockReset();
    selectionEmphasisMock.retain
      .mockReset()
      .mockReturnValue({ release: selectionEmphasisMock.release, setVisible: selectionEmphasisMock.setVisible });
    const addedCommand = {
      current: null as null | { editorCheckCallback: (checking: boolean, editor: unknown, view: unknown) => boolean },
    };
    const lifetime = new (class extends Plugin {})({} as never, {} as never);
    lifetime.load();
    const plugin = {
      settings: {
        codexPath: "/usr/local/bin/codex",
        sendShortcut: "enter",
        rewriteSelectionModel: null,
        rewriteSelectionEffort: null,
      },
      vaultPath: "/vault",
      register: (callback: () => void) => lifetime.register(callback),
      addCommand: vi.fn((command: { editorCheckCallback: (checking: boolean, editor: unknown, view: unknown) => boolean }) => {
        addedCommand.current = command;
      }),
    };
    const from = { line: 1, ch: 0 };
    const to = { line: 1, ch: 22 };
    const editor = {
      getSelection: vi.fn(() => "Revise this sentence."),
      getValue: vi.fn(() => "# Draft heading\n\nRevise this sentence.\n\nUnsaved paragraph."),
      getCursor: vi.fn((which: "from" | "to") => (which === "from" ? from : to)),
    };
    const view = new MarkdownView({} as never);
    const containerEl = document.createElement("div");
    Object.defineProperty(containerEl, "doc", { value: document });
    Object.assign(view, { containerEl });
    view.file = Object.assign(new TFile(), { path: "Draft.md", basename: "Draft" });

    const port: SelectionRewritePort = { generate: async () => ({ replacementText: "" }) };
    const controller = registerSelectionRewriteCommand(plugin as never, port);
    expect(addedCommand.current).not.toBeNull();
    expect(addedCommand.current?.editorCheckCallback(true, editor, view)).toBe(true);
    expect(popoverMock.instances).toHaveLength(0);
    expect(addedCommand.current?.editorCheckCallback(false, editor, view)).toBe(true);
    from.line = 99;
    to.ch = 99;

    const captured = popoverMock.instances[0]?.options.state;
    expect(captured).toMatchObject({
      filePath: "Draft.md",
      originalText: "Revise this sentence.",
      noteText: "# Draft heading\n\nRevise this sentence.\n\nUnsaved paragraph.",
      targetRange: {
        from: { line: 1, ch: 0 },
        to: { line: 1, ch: 22 },
      },
    });
    expect(popoverMock.instances[0]?.open).toHaveBeenCalledOnce();
    expect(popoverMock.instances[0]?.options.port).toBe(port);
    expect(selectionEmphasisMock.retain).toHaveBeenCalledWith(editor, captured?.targetRange);

    expect(addedCommand.current?.editorCheckCallback(false, editor, view)).toBe(true);
    expect(popoverMock.instances).toHaveLength(2);
    expect(popoverMock.instances[0]?.close).toHaveBeenCalledOnce();
    expect(popoverMock.instances[1]?.open).toHaveBeenCalledOnce();

    controller.closeAll();
    expect(popoverMock.instances[1]?.close).toHaveBeenCalledOnce();
    expect(selectionEmphasisMock.release).toHaveBeenCalledTimes(2);

    expect(addedCommand.current?.editorCheckCallback(false, editor, view)).toBe(true);
    expect(popoverMock.instances[2]?.open).toHaveBeenCalledOnce();
    lifetime.unload();
    expect(popoverMock.instances[2]?.close).toHaveBeenCalledOnce();
    expect(selectionEmphasisMock.release).toHaveBeenCalledTimes(3);
    lifetime.unload();
    expect(popoverMock.instances[2]?.close).toHaveBeenCalledOnce();
  });

  it("keeps the command unavailable without a non-empty markdown selection", () => {
    popoverMock.reset();
    const addedCommand = {
      current: null as null | { editorCheckCallback: (checking: boolean, editor: unknown, view: unknown) => boolean },
    };
    const plugin = {
      settings: { sendShortcut: "enter" },
      register: () => undefined,
      addCommand: vi.fn((command: { editorCheckCallback: (checking: boolean, editor: unknown, view: unknown) => boolean }) => {
        addedCommand.current = command;
      }),
    };
    registerSelectionRewriteCommand(plugin as never, { generate: async () => ({ replacementText: "" }) });
    const editor = { getSelection: vi.fn(() => "   ") };
    const markdownView = new MarkdownView({} as never);
    markdownView.file = Object.assign(new TFile(), { path: "Draft.md", basename: "Draft" });

    expect(addedCommand.current?.editorCheckCallback(true, editor, markdownView)).toBe(false);
    editor.getSelection.mockReturnValue("Rewrite me");
    expect(addedCommand.current?.editorCheckCallback(true, editor, {})).toBe(false);
    expect(popoverMock.instances).toHaveLength(0);
  });
});
