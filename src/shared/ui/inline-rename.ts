export interface InlineRenameOptions {
  className: string;
  value: string;
  ariaLabel: string;
  onUpdate: (value: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
  canSave?: () => boolean;
}

export interface InlineRenameEditor {
  element: HTMLElement;
  value: () => string;
}

export function createInlineRenameEditor(parent: HTMLElement, options: InlineRenameOptions): InlineRenameEditor {
  const editor = parent.createDiv({
    cls: options.className,
    text: options.value,
    attr: {
      role: "textbox",
      "aria-label": options.ariaLabel,
      spellcheck: "false",
      contenteditable: "plaintext-only",
    },
  });

  editor.oninput = () => {
    options.onUpdate(editorText(editor));
  };
  editor.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!event.isComposing && (options.canSave?.() ?? true)) options.onSave(editorText(editor));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      options.onCancel();
    }
  };
  editor.onpaste = (event) => {
    event.preventDefault();
    insertPlainText(editor, event.clipboardData?.getData("text/plain") ?? "");
    options.onUpdate(editorText(editor));
  };

  editor.win.setTimeout(() => {
    if (editor.ownerDocument.activeElement !== editor) {
      editor.focus();
      selectElementText(editor);
    }
  }, 0);

  return { element: editor, value: () => editorText(editor) };
}

function editorText(editor: HTMLElement): string {
  return editor.textContent.replace(/\s+/g, " ");
}

function insertPlainText(editor: HTMLElement, text: string): void {
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    editor.textContent = `${editor.textContent}${text}`;
    return;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    editor.textContent = `${editor.textContent}${text}`;
    return;
  }

  range.deleteContents();
  const node = editor.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectElementText(editor: HTMLElement): void {
  const selection = editor.ownerDocument.getSelection();
  if (!selection) return;
  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
}
