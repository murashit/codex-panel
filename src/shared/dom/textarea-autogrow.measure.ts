export interface TextareaHeightOptions {
  minHeightFallback: number;
  maxHeightFallback: number;
}

const textareaHeightMirrors = new WeakMap<Document, HTMLTextAreaElement>();
const textareaHeightMirrorDocuments = new Set<Document>();
const TEXTAREA_HEIGHT_MIRROR_CLASS = "codex-panel-textarea-height-mirror";

export function syncTextareaHeight(textarea: HTMLTextAreaElement | null, options: TextareaHeightOptions): void {
  if (!textarea) return;
  const style = getComputedStyle(textarea);
  const win = textarea.win;
  const minHeight = parseCssPixels(style.minHeight, options.minHeightFallback);
  const maxHeight = parseCssLengthExpression(style.maxHeight, win) ?? options.maxHeightFallback;
  const measuredScrollHeight = measureTextareaNaturalScrollHeight(textarea, style);
  const nextHeight = Math.min(Math.max(measuredScrollHeight, minHeight), maxHeight);
  const sizingProps: Record<string, string> = {
    height: `${String(nextHeight)}px`,
    "overflow-y": measuredScrollHeight > maxHeight ? "auto" : "hidden",
  };
  textarea.setCssProps(sizingProps);
}

export function disposeTextareaHeightMirrors(): void {
  for (const doc of textareaHeightMirrorDocuments) {
    for (const mirror of doc.querySelectorAll(`.${TEXTAREA_HEIGHT_MIRROR_CLASS}`)) mirror.remove();
    textareaHeightMirrors.delete(doc);
  }
  textareaHeightMirrorDocuments.clear();
}

function measureTextareaNaturalScrollHeight(textarea: HTMLTextAreaElement, style: CSSStyleDeclaration): number {
  const mirror = textareaHeightMirror(textarea.ownerDocument);
  mirror.value = textarea.value;
  syncTextareaMirrorStyle(mirror, textarea, style);
  return mirror.scrollHeight;
}

function textareaHeightMirror(doc: Document): HTMLTextAreaElement {
  const existing = textareaHeightMirrors.get(doc);
  if (existing?.isConnected) return existing;
  const staleMirrors = [...doc.querySelectorAll<HTMLTextAreaElement>(`.${TEXTAREA_HEIGHT_MIRROR_CLASS}`)];
  // eslint-disable-next-line obsidianmd/prefer-create-el -- This detached mirror must belong to the measured textarea's document.
  const mirror = staleMirrors.shift() ?? doc.createElement("textarea");
  for (const duplicate of staleMirrors) duplicate.remove();
  mirror.tabIndex = -1;
  mirror.setAttribute("aria-hidden", "true");
  mirror.readOnly = true;
  mirror.addClass(TEXTAREA_HEIGHT_MIRROR_CLASS);
  if (!mirror.isConnected) doc.body.appendChild(mirror);
  textareaHeightMirrors.set(doc, mirror);
  textareaHeightMirrorDocuments.add(doc);
  return mirror;
}

function syncTextareaMirrorStyle(mirror: HTMLTextAreaElement, textarea: HTMLTextAreaElement, style: CSSStyleDeclaration): void {
  const rect = textarea.getBoundingClientRect();
  const width = style.boxSizing === "border-box" ? `${String(rect.width)}px` : style.width;
  mirror.style.setProperty("width", width);
  for (const property of TEXTAREA_MIRROR_CSS_PROPERTIES) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
}

function parseCssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCssLengthExpression(value: string, win: Window): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return null;
  if (/^min\(/i.test(trimmed)) {
    const values = Array.from(trimmed.matchAll(/(-?\d+(?:\.\d+)?)\s*(px|vh)/gi), (match) => {
      const value = match[1];
      const unit = match[2];
      return value && unit ? cssLengthToPixels(Number.parseFloat(value), unit, win) : Number.NaN;
    }).filter((candidate): candidate is number => Number.isFinite(candidate));
    return values.length > 0 ? Math.min(...values) : null;
  }
  const length = /^(-?\d+(?:\.\d+)?)\s*(px|vh)$/i.exec(trimmed);
  if (!length?.[1] || !length[2]) return null;
  return cssLengthToPixels(Number.parseFloat(length[1]), length[2], win);
}

function cssLengthToPixels(value: number, unit: string, win: Window): number {
  if (unit.toLowerCase() === "vh") return (win.innerHeight * value) / 100;
  return value;
}

const TEXTAREA_MIRROR_CSS_PROPERTIES = [
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-top-width",
  "box-sizing",
  "direction",
  "font-family",
  "font-feature-settings",
  "font-kerning",
  "font-language-override",
  "font-optical-sizing",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-synthesis",
  "font-variant",
  "font-variant-alternates",
  "font-variant-caps",
  "font-variant-east-asian",
  "font-variant-ligatures",
  "font-variant-numeric",
  "font-variant-position",
  "font-variation-settings",
  "font-weight",
  "letter-spacing",
  "line-height",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "tab-size",
  "text-align",
  "text-indent",
  "text-rendering",
  "text-transform",
  "white-space",
  "word-break",
  "word-spacing",
  "overflow-wrap",
] as const;
