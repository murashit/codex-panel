import { type Editor, MarkdownView, Notice, type Plugin } from "obsidian";
import type { SendShortcut } from "../../domain/input/send-shortcut";
import { fileReferencePath } from "../../shared/obsidian/file-path.obsidian";
import type { SelectionRewriteInput, SelectionRewriteRuntimeSettings } from "./model";
import { openSelectionRewritePopover, type SelectionRewritePopoverHandle } from "./popover.dom";
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
  let popover: SelectionRewritePopoverHandle | null = null;
  const closeAll = (): void => {
    popover?.close();
    popover = null;
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

      const targetRange = {
        from: clonePosition(editor.getCursor("from")),
        to: clonePosition(editor.getCursor("to")),
      };
      const input: SelectionRewriteInput = {
        filePath: fileReferencePath(view.file),
        targetRange,
        selectionOffsets: { from: editor.posToOffset(targetRange.from), to: editor.posToOffset(targetRange.to) },
        originalText,
        noteText: editor.getValue(),
      };

      popover?.close();
      popover = openSelectionRewritePopover({
        editor,
        runtimeSettings: plugin.settings,
        sendShortcut: plugin.settings.sendShortcut,
        input,
        port,
        viewDocument,
        viewWindow,
      });
      return true;
    },
  });

  return { closeAll };
}

function clonePosition(position: ReturnType<Editor["getCursor"]>): ReturnType<Editor["getCursor"]> {
  return { line: position.line, ch: position.ch };
}
