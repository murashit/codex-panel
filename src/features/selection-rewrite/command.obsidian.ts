import { type Editor, MarkdownView, Notice, type Plugin } from "obsidian";
import type { SendShortcut } from "../../domain/input/send-shortcut";
import { retainEditorSelectionEmphasis } from "../../shared/obsidian/editor-selection-emphasis.obsidian";
import type { SelectionRewriteRuntimeSettings, SelectionRewriteState } from "./model";
import { SelectionRewritePopover } from "./popover.dom";
import type { SelectionRewritePort } from "./port";

export interface SelectionRewriteCommandHost extends Plugin {
  settings: { sendShortcut: SendShortcut } & SelectionRewriteRuntimeSettings;
}

export interface SelectionRewriteCommandController {
  closeAll(): void;
}

export function registerSelectionRewriteCommand(
  plugin: SelectionRewriteCommandHost,
  port: SelectionRewritePort,
): SelectionRewriteCommandController {
  let activePopover: SelectionRewritePopover | null = null;
  const closeAll = (): void => {
    activePopover?.close();
    activePopover = null;
  };

  plugin.register(closeAll);

  plugin.addCommand({
    id: "rewrite-selection",
    name: "Rewrite selection",
    editorCheckCallback: (checking, editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file) return false;
      const originalText = editor.getSelection();
      if (!originalText.trim()) return false;
      if (checking) return true;

      const viewDocument = view.containerEl.doc;
      const viewWindow = viewDocument.defaultView;
      if (!viewWindow) {
        new Notice("Could not open rewrite popover for this note.");
        return false;
      }

      const rewriteState: SelectionRewriteState = {
        filePath: view.file.path,
        targetRange: {
          from: clonePosition(editor.getCursor("from")),
          to: clonePosition(editor.getCursor("to")),
        },
        originalText,
        noteText: editor.getValue(),
        instruction: "",
        status: "editing",
        streamText: "",
        replacementText: null,
        debugText: null,
      };

      activePopover?.close();
      const releaseSelectionEmphasis = retainEditorSelectionEmphasis(editor, rewriteState.targetRange);
      const popover = new SelectionRewritePopover({
        editor,
        onClose: () => {
          releaseSelectionEmphasis?.release();
          if (activePopover === popover) activePopover = null;
        },
        runtimeSettings: plugin.settings,
        sendShortcut: plugin.settings.sendShortcut,
        state: rewriteState,
        port,
        viewDocument,
        viewWindow,
      });
      activePopover = popover;
      popover.open();
      return true;
    },
  });

  return { closeAll };
}

function clonePosition(position: ReturnType<Editor["getCursor"]>): ReturnType<Editor["getCursor"]> {
  return { line: position.line, ch: position.ch };
}
