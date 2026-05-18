import { MarkdownView, Notice, type Editor, type Plugin } from "obsidian";

import type { RewriteRuntimeSettings, RewriteSession } from "./model";
import { RewriteSelectionPopover } from "./popover";
import type { SendShortcut } from "../settings/model";

export interface RewriteSelectionCommandHost extends Plugin {
  settings: {
    codexPath: string;
    sendShortcut: SendShortcut;
  } & RewriteRuntimeSettings;
  vaultPath: string;
}

export function registerRewriteSelectionCommand(plugin: RewriteSelectionCommandHost): void {
  plugin.addCommand({
    id: "rewrite-selection",
    name: "Rewrite selection",
    editorCallback: (editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file) {
        new Notice("Rewrite selection requires an active markdown note.");
        return;
      }

      const originalText = editor.getSelection();
      if (!originalText.trim()) {
        new Notice("Select text to rewrite first.");
        return;
      }

      const session: RewriteSession = {
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

      new RewriteSelectionPopover({
        codexPath: plugin.settings.codexPath,
        cwd: plugin.vaultPath,
        editor,
        runtimeSettings: plugin.settings,
        sendShortcut: plugin.settings.sendShortcut,
        session,
      }).open();
    },
  });
}

function clonePosition(position: ReturnType<Editor["getCursor"]>): ReturnType<Editor["getCursor"]> {
  return { line: position.line, ch: position.ch };
}
