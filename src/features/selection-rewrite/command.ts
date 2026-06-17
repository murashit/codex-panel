import { MarkdownView, Notice, type Editor, type Plugin } from "obsidian";

import type { SelectionRewriteRuntimeSettings, SelectionRewriteState } from "./model";
import { SelectionRewritePopover } from "./popover";
import type { SendShortcut } from "../../shared/ui/keyboard";

export interface SelectionRewriteCommandHost extends Plugin {
  settings: {
    codexPath: string;
    sendShortcut: SendShortcut;
  } & SelectionRewriteRuntimeSettings;
  vaultPath: string;
}

export function registerSelectionRewriteCommand(plugin: SelectionRewriteCommandHost): void {
  const activePopovers = new Set<SelectionRewritePopover>();

  plugin.register(() => {
    for (const popover of activePopovers) popover.close();
    activePopovers.clear();
  });

  plugin.addCommand({
    id: "rewrite-selection",
    name: "Rewrite selection",
    editorCallback: (editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file) {
        new Notice("Select text in an active markdown note first.");
        return;
      }

      const originalText = editor.getSelection();
      if (!originalText.trim()) {
        new Notice("Select text to rewrite first.");
        return;
      }
      const viewDocument = view.containerEl.doc;
      const viewWindow = viewDocument.defaultView;
      if (!viewWindow) {
        new Notice("Could not open rewrite popover for this note.");
        return;
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
        status: "editing-prompt",
        streamText: "",
        replacementText: null,
        debugText: null,
      };

      let popover: SelectionRewritePopover | null = null;
      popover = new SelectionRewritePopover({
        codexPath: plugin.settings.codexPath,
        cwd: plugin.vaultPath,
        editor,
        onClose: () => {
          if (popover) activePopovers.delete(popover);
        },
        runtimeSettings: plugin.settings,
        sendShortcut: plugin.settings.sendShortcut,
        state: rewriteState,
        viewDocument,
        viewWindow,
      });
      popover.open();
      activePopovers.add(popover);
    },
  });
}

function clonePosition(position: ReturnType<Editor["getCursor"]>): ReturnType<Editor["getCursor"]> {
  return { line: position.line, ch: position.ch };
}
