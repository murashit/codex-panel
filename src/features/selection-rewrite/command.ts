import { MarkdownView, Notice, type Editor, type Plugin } from "obsidian";

import type { SelectionRewriteRuntimeSettings, SelectionRewriteSession } from "./model";
import { SelectionRewritePopover } from "./popover";
import type { SendShortcut } from "../../settings/model";

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

      const session: SelectionRewriteSession = {
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

      const popover = new SelectionRewritePopover({
        codexPath: plugin.settings.codexPath,
        cwd: plugin.vaultPath,
        editor,
        onClose: () => activePopovers.delete(popover),
        runtimeSettings: plugin.settings,
        sendShortcut: plugin.settings.sendShortcut,
        session,
      });
      popover.open();
      activePopovers.add(popover);
    },
  });
}

function clonePosition(position: ReturnType<Editor["getCursor"]>): ReturnType<Editor["getCursor"]> {
  return { line: position.line, ch: position.ch };
}
