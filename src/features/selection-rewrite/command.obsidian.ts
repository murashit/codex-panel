import { type Editor, MarkdownView, Notice, type Plugin } from "obsidian";
import type { SendShortcut } from "../../domain/input/send-shortcut";
import type { SelectionRewriteRuntimeSettings, SelectionRewriteState } from "./model";
import { SelectionRewritePopover } from "./popover.dom";
import type { SelectionRewriteTransport } from "./transport";

export interface SelectionRewriteCommandHost extends Plugin {
  settings: { sendShortcut: SendShortcut } & SelectionRewriteRuntimeSettings;
}

export interface SelectionRewriteCommandController {
  closeAll(): void;
}

export function registerSelectionRewriteCommand(
  plugin: SelectionRewriteCommandHost,
  transport: SelectionRewriteTransport,
): SelectionRewriteCommandController {
  const activePopovers = new Set<SelectionRewritePopover>();
  const closeAll = (): void => {
    for (const popover of activePopovers) popover.close();
    activePopovers.clear();
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

      let popover: SelectionRewritePopover | null = null;
      popover = new SelectionRewritePopover({
        editor,
        onClose: () => {
          if (popover) activePopovers.delete(popover);
        },
        runtimeSettings: plugin.settings,
        sendShortcut: plugin.settings.sendShortcut,
        state: rewriteState,
        transport,
        viewDocument,
        viewWindow,
      });
      popover.open();
      activePopovers.add(popover);
      return true;
    },
  });

  return { closeAll };
}

function clonePosition(position: ReturnType<Editor["getCursor"]>): ReturnType<Editor["getCursor"]> {
  return { line: position.line, ch: position.ch };
}
