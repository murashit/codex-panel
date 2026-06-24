import { type DiffLineClass, type DisplayDiffLine, diffLineClass, diffLineClassFromText, displayDiffLineText } from "./unified";

const MAX_INLINE_DIFF_CHARS = 4000;
const MAX_INLINE_DIFF_TOKENS = 500;

interface InlineDiffPart {
  text: string;
  changed: boolean;
}

interface InlineDiff {
  added: InlineDiffPart[];
  removed: InlineDiffPart[];
}

interface RenderDiffLine {
  text: string;
  className: DiffLineClass;
}

type ChangeLineClass = "added" | "removed";

export interface RenderDiffLinesOptions {
  className?: string;
}

export function renderDisplayDiffLines(parent: HTMLElement, lines: DisplayDiffLine[], options: RenderDiffLinesOptions = {}): HTMLElement {
  return renderDiffLines(
    parent,
    lines.map((line) => ({ text: line.text, className: diffLineClass(line) })),
    options,
  );
}

export function renderRawDiffLines(parent: HTMLElement, diff: string, options: RenderDiffLinesOptions = {}): HTMLElement {
  return renderDiffLines(
    parent,
    diff.split("\n").map((line) => ({ text: line, className: diffLineClassFromText(line) })),
    options,
  );
}

function renderDiffLines(parent: HTMLElement, lines: RenderDiffLine[], options: RenderDiffLinesOptions): HTMLElement {
  const className = ["codex-panel-diff", options.className].filter(Boolean).join(" ");
  const pre = parent.createEl("pre", { cls: className });

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const changeClass = changeLineClass(line.className);
    if (!changeClass) {
      renderLine(pre, line);
      continue;
    }

    const firstRun = collectChangeRun(lines, index, changeClass);
    const secondRun = collectChangeRun(lines, firstRun.endIndex, oppositeChangeLineClass(changeClass));
    if (secondRun.lines.length > 0) {
      renderChangeRuns(pre, firstRun.lines, secondRun.lines);
      index = secondRun.endIndex - 1;
      continue;
    }

    for (const runLine of firstRun.lines) {
      renderLine(pre, runLine);
    }
    index = firstRun.endIndex - 1;
  }

  return pre;
}

function collectChangeRun(
  lines: RenderDiffLine[],
  startIndex: number,
  className: ChangeLineClass,
): { lines: RenderDiffLine[]; endIndex: number } {
  const run: RenderDiffLine[] = [];
  let index = startIndex;
  while (index < lines.length && lines[index]?.className === className) {
    const line = lines[index];
    if (line) run.push(line);
    index += 1;
  }
  return { lines: run, endIndex: index };
}

function renderChangeRuns(parent: HTMLElement, firstRun: RenderDiffLine[], secondRun: RenderDiffLine[]): void {
  const inlineDiffs = pairedInlineDiffs(firstRun, secondRun);
  for (let index = 0; index < firstRun.length; index += 1) {
    const line = firstRun[index];
    if (!line) continue;
    renderLine(parent, line, inlinePartsForLine(line.className, inlineDiffs[index] ?? null));
  }
  for (let index = 0; index < secondRun.length; index += 1) {
    const line = secondRun[index];
    if (!line) continue;
    renderLine(parent, line, inlinePartsForLine(line.className, inlineDiffs[index] ?? null));
  }
}

function pairedInlineDiffs(firstRun: RenderDiffLine[], secondRun: RenderDiffLine[]): (InlineDiff | null)[] {
  const pairCount = Math.min(firstRun.length, secondRun.length);
  const inlineDiffs: (InlineDiff | null)[] = [];
  for (let index = 0; index < pairCount; index += 1) {
    const firstLine = firstRun[index];
    const secondLine = secondRun[index];
    if (!firstLine || !secondLine) {
      inlineDiffs.push(null);
    } else {
      inlineDiffs.push(inlineDiffForLines(firstLine, secondLine));
    }
  }
  return inlineDiffs;
}

function inlineDiffForLines(firstLine: RenderDiffLine, secondLine: RenderDiffLine): InlineDiff | null {
  const removedLine = firstLine.className === "removed" ? firstLine : secondLine;
  const addedLine = firstLine.className === "added" ? firstLine : secondLine;
  return inlineDiff(displayDiffLineText(removedLine.text, removedLine.className), displayDiffLineText(addedLine.text, addedLine.className));
}

function inlinePartsForLine(className: DiffLineClass, inlineDiff: InlineDiff | null): InlineDiffPart[] | null {
  if (!inlineDiff) return null;
  if (className === "removed") return inlineDiff.removed;
  if (className === "added") return inlineDiff.added;
  return null;
}

function changeLineClass(className: DiffLineClass): ChangeLineClass | null {
  return className === "added" || className === "removed" ? className : null;
}

function oppositeChangeLineClass(className: ChangeLineClass): ChangeLineClass {
  return className === "added" ? "removed" : "added";
}

function renderLine(parent: HTMLElement, line: RenderDiffLine, inlineParts: InlineDiffPart[] | null = null): void {
  const lineEl = parent.createEl("span", { cls: `codex-panel-diff__line codex-panel-diff__line--${line.className}` });
  if (!inlineParts) {
    lineEl.textContent = displayDiffLineText(line.text, line.className);
    return;
  }
  for (const part of inlineParts) {
    if (part.changed) {
      lineEl.createSpan({ cls: `codex-panel-diff__word codex-panel-diff__word--${line.className}`, text: part.text });
    } else {
      lineEl.createSpan({ text: part.text });
    }
  }
}

function inlineDiff(removedText: string, addedText: string): InlineDiff | null {
  if (removedText.length + addedText.length > MAX_INLINE_DIFF_CHARS) return null;

  const removedTokens = segmentWords(removedText);
  const addedTokens = segmentWords(addedText);
  if (removedTokens.length + addedTokens.length > MAX_INLINE_DIFF_TOKENS) return null;

  const lengths = lcsLengths(removedTokens, addedTokens);
  const removed: InlineDiffPart[] = [];
  const added: InlineDiffPart[] = [];
  let removedIndex = 0;
  let addedIndex = 0;

  while (removedIndex < removedTokens.length || addedIndex < addedTokens.length) {
    const removedToken = removedTokens[removedIndex];
    const addedToken = addedTokens[addedIndex];
    if (removedToken !== undefined && addedToken !== undefined && removedToken === addedToken) {
      removed.push({ text: removedToken, changed: false });
      added.push({ text: addedToken, changed: false });
      removedIndex += 1;
      addedIndex += 1;
    } else if (
      addedToken !== undefined &&
      (removedToken === undefined || (lengths[removedIndex]?.[addedIndex + 1] ?? 0) >= (lengths[removedIndex + 1]?.[addedIndex] ?? 0))
    ) {
      added.push({ text: addedToken, changed: true });
      addedIndex += 1;
    } else if (removedToken !== undefined) {
      removed.push({ text: removedToken, changed: true });
      removedIndex += 1;
    }
  }

  return { added: mergeInlineParts(added), removed: mergeInlineParts(removed) };
}

function segmentWords(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return Array.from(segmenter.segment(text), (segment) => segment.segment);
}

function lcsLengths(left: string[], right: string[]): number[][] {
  const rows = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const row = rows[leftIndex];
      if (!row) continue;
      row[rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? (rows[leftIndex + 1]?.[rightIndex + 1] ?? 0) + 1
          : Math.max(rows[leftIndex + 1]?.[rightIndex] ?? 0, rows[leftIndex]?.[rightIndex + 1] ?? 0);
    }
  }
  return rows;
}

function mergeInlineParts(parts: InlineDiffPart[]): InlineDiffPart[] {
  const merged: InlineDiffPart[] = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    if (previous?.changed === part.changed) {
      previous.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}
