export interface TextareaHeightOptions {
  minHeightFallback: number;
  maxHeightFallback: number;
}

export function syncTextareaHeight(textarea: HTMLTextAreaElement | null, options: TextareaHeightOptions): void {
  if (!textarea) return;
  const style = getComputedStyle(textarea);
  const win = textarea.win;
  const minHeight = parseCssPixels(style.minHeight, options.minHeightFallback);
  const maxHeight = parseCssLengthExpression(style.maxHeight, win) ?? options.maxHeightFallback;
  const resetHeightProps: Record<string, string> = { height: "auto" };
  textarea.setCssProps(resetHeightProps);
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
  const sizingProps: Record<string, string> = {
    height: `${String(nextHeight)}px`,
    "overflow-y": textarea.scrollHeight > maxHeight ? "auto" : "hidden",
  };
  textarea.setCssProps(sizingProps);
}

function parseCssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCssLengthExpression(value: string, win: Window): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return null;
  if (/^min\(/i.test(trimmed)) {
    const values = Array.from(trimmed.matchAll(/(-?\d+(?:\.\d+)?)\s*(px|vh)/gi), (match) =>
      cssLengthToPixels(Number.parseFloat(match[1]), match[2], win),
    ).filter((candidate): candidate is number => Number.isFinite(candidate));
    return values.length > 0 ? Math.min(...values) : null;
  }
  const length = /^(-?\d+(?:\.\d+)?)\s*(px|vh)$/i.exec(trimmed);
  if (!length) return null;
  return cssLengthToPixels(Number.parseFloat(length[1]), length[2], win);
}

function cssLengthToPixels(value: number, unit: string, win: Window): number {
  if (unit.toLowerCase() === "vh") return (win.innerHeight * value) / 100;
  return value;
}
