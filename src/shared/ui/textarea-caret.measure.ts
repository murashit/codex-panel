export type TextareaCaretBoundaryDirection = -1 | 1;

export function textareaCursorAtVisualBoundary(direction: TextareaCaretBoundaryDirection, textarea: HTMLTextAreaElement): boolean {
  if (textarea.selectionStart !== textarea.selectionEnd) return false;

  const bounds = textarea.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return true;

  const lineStart = textarea.value.lastIndexOf("\n", Math.max(0, textarea.selectionStart - 1)) + 1;
  const nextLineBreak = textarea.value.indexOf("\n", textarea.selectionEnd);
  const lineEnd = nextLineBreak === -1 ? textarea.value.length : nextLineBreak;

  const cursorTop = textareaCaretTop(textarea, textarea.selectionStart);
  const boundaryTop = textareaCaretTop(textarea, direction === -1 ? lineStart : lineEnd);
  if (cursorTop === null || boundaryTop === null) return true;

  const tolerance = 1;
  return direction === -1 ? cursorTop <= boundaryTop + tolerance : cursorTop >= boundaryTop - tolerance;
}

const textareaMirrorStyleProperties = [
  "boxSizing",
  "width",
  "height",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textIndent",
  "textTransform",
  "wordSpacing",
  "tabSize",
] as const;

const textareaMirrorLayoutProps: Record<string, string> = {
  position: "absolute",
  visibility: "hidden",
  left: "-9999px",
  top: "0",
  height: "auto",
  "min-height": "0",
  "max-height": "none",
  overflow: "hidden",
  "white-space": "pre-wrap",
  "overflow-wrap": "break-word",
  "word-break": "normal",
};

function textareaCaretTop(textarea: HTMLTextAreaElement, position: number): number | null {
  const document = textarea.ownerDocument;
  const window = document.defaultView;
  if (!window) return null;

  const style = window.getComputedStyle(textarea);
  const mirror = document.body.createDiv();
  mirror.remove();
  for (const property of textareaMirrorStyleProperties) {
    mirror.style[property] = style[property];
  }

  const bounds = textarea.getBoundingClientRect();
  const mirrorProps = {
    ...textareaMirrorLayoutProps,
    width: `${String(bounds.width)}px`,
  };
  mirror.setCssProps(mirrorProps);

  const marker = mirror.createSpan({ text: "\u200b" });
  mirror.prepend(document.createTextNode(textarea.value.slice(0, position)));
  document.body.append(mirror);

  const top = marker.offsetTop;
  mirror.remove();
  return top;
}
