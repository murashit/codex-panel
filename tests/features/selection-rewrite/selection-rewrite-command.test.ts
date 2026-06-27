// @vitest-environment jsdom

import { MarkdownView, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { registerSelectionRewriteCommand } from "../../../src/features/selection-rewrite/command.obsidian";
import type { SelectionRewritePopoverOptions } from "../../../src/features/selection-rewrite/popover.dom";

const popoverMock = vi.hoisted(() => {
  const instances: { options: SelectionRewritePopoverOptions; open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  return {
    instances,
    reset(): void {
      instances.length = 0;
    },
  };
});

vi.mock("../../../src/features/selection-rewrite/popover.dom", () => {
  class SelectionRewritePopover {
    readonly open = vi.fn();
    readonly close = vi.fn();

    constructor(readonly options: SelectionRewritePopoverOptions) {
      popoverMock.instances.push({ options, open: this.open, close: this.close });
    }
  }

  return { SelectionRewritePopover };
});

describe("selection rewrite command", () => {
  it("captures the unsaved editor buffer and clones the target range", () => {
    popoverMock.reset();
    const addedCommand = { current: null as null | { editorCallback: (editor: unknown, view: unknown) => void } };
    const cleanup = { current: null as null | (() => void) };
    const plugin = {
      settings: {
        codexPath: "/usr/local/bin/codex",
        sendShortcut: "enter",
        rewriteSelectionModel: null,
        rewriteSelectionEffort: null,
      },
      vaultPath: "/vault",
      register: vi.fn((callback: () => void) => {
        cleanup.current = callback;
      }),
      addCommand: vi.fn((command: { editorCallback: (editor: unknown, view: unknown) => void }) => {
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
    Object.assign(view, { containerEl: { doc: document } });
    view.file = Object.assign(new TFile(), { path: "Draft.md", basename: "Draft" });

    registerSelectionRewriteCommand(plugin as never);
    expect(addedCommand.current).not.toBeNull();
    addedCommand.current?.editorCallback(editor, view);
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

    cleanup.current?.();
    expect(popoverMock.instances[0]?.close).toHaveBeenCalledOnce();
  });
});
