import type { ComponentChild as UiNode } from "preact";

const MAX_INLINE_DIFF_CHARS = 4000;
const MAX_INLINE_DIFF_TOKENS = 500;

export interface DiffDisplayLine {
  text: string;
  kind?: "file";
}

type DiffLineClass = "added" | "removed" | "hunk" | "context" | "file";

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

interface DiffLineView extends RenderDiffLine {
  inlineParts: InlineDiffPart[] | null;
}

type ChangeLineClass = "added" | "removed";

export function unifiedDiffDisplayLines(diff: string): DiffDisplayLine[] {
  const displayLines: DiffDisplayLine[] = [];
  let inFileHeader = false;
  for (const line of diff.split("\n")) {
    const file = filePathFromGitDiffHeader(line);
    if (file) {
      displayLines.push({ text: file, kind: "file" });
      inFileHeader = true;
      continue;
    }
    if (line.startsWith("@@")) inFileHeader = false;
    if (inFileHeader && (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ "))) continue;
    displayLines.push({ text: line });
  }
  return displayLines;
}

export function UnifiedDiffView({ diff, className }: { diff: string; className?: string | undefined }): UiNode {
  return <DiffLineList lines={unifiedDiffDisplayLines(diff)} className={className} />;
}

export function DiffLineList({ lines, className }: { lines: readonly DiffDisplayLine[]; className?: string | undefined }): UiNode {
  return <DiffLineFrame lines={lines.map((line) => ({ text: line.text, className: diffLineClass(line) }))} className={className} />;
}

export function RawDiffView({ diff, className }: { diff: string; className?: string | undefined }): UiNode {
  return (
    <DiffLineFrame lines={diff.split("\n").map((line) => ({ text: line, className: diffLineClassFromText(line) }))} className={className} />
  );
}

function diffLineClass(line: DiffDisplayLine): DiffLineClass {
  if (line.kind === "file") return "file";
  return diffLineClassFromText(line.text);
}

function diffLineClassFromText(text: string): Exclude<DiffLineClass, "file"> {
  if (text.startsWith("+") && !text.startsWith("+++")) return "added";
  if (text.startsWith("-") && !text.startsWith("---")) return "removed";
  if (text.startsWith("@@")) return "hunk";
  return "context";
}

function displayDiffLineText(text: string, lineClass: DiffLineClass): string {
  const displayText = lineClass === "added" || lineClass === "removed" ? text.slice(1) : text;
  return displayText || " ";
}

function filePathFromGitDiffHeader(line: string): string | null {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match) return null;
  return match[2] ?? null;
}

function DiffLineFrame({ lines, className }: { lines: readonly RenderDiffLine[]; className?: string | undefined }): UiNode {
  const preClassName = ["codex-panel-diff", className].filter(Boolean).join(" ");
  return (
    <pre className={preClassName}>
      {diffLineViews(lines).map((line, index) => (
        <DiffLine key={`${String(index)}:${line.className}:${line.text}`} line={line} />
      ))}
    </pre>
  );
}

function diffLineViews(lines: readonly RenderDiffLine[]): DiffLineView[] {
  const views: DiffLineView[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const changeClass = changeLineClass(line.className);
    if (!changeClass) {
      views.push({ ...line, inlineParts: null });
      continue;
    }

    const firstRun = collectChangeRun(lines, index, changeClass);
    const secondRun = collectChangeRun(lines, firstRun.endIndex, oppositeChangeLineClass(changeClass));
    if (secondRun.lines.length > 0) {
      views.push(...changeRunViews(firstRun.lines, secondRun.lines));
      index = secondRun.endIndex - 1;
      continue;
    }

    for (const runLine of firstRun.lines) {
      views.push({ ...runLine, inlineParts: null });
    }
    index = firstRun.endIndex - 1;
  }

  return views;
}

function collectChangeRun(
  lines: readonly RenderDiffLine[],
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

function changeRunViews(firstRun: RenderDiffLine[], secondRun: RenderDiffLine[]): DiffLineView[] {
  const inlineDiffs = pairedInlineDiffs(firstRun, secondRun);
  const views: DiffLineView[] = [];
  for (let index = 0; index < firstRun.length; index += 1) {
    const line = firstRun[index];
    if (!line) continue;
    views.push({ ...line, inlineParts: inlinePartsForLine(line.className, inlineDiffs[index] ?? null) });
  }
  for (let index = 0; index < secondRun.length; index += 1) {
    const line = secondRun[index];
    if (!line) continue;
    views.push({ ...line, inlineParts: inlinePartsForLine(line.className, inlineDiffs[index] ?? null) });
  }
  return views;
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

function DiffLine({ line }: { line: DiffLineView }): UiNode {
  return (
    <span className={diffLineClassName(line.className)}>
      {line.inlineParts
        ? line.inlineParts.map((part, index) => (
            <span
              key={`${String(index)}:${part.changed ? "changed" : "same"}:${part.text}`}
              className={part.changed ? diffWordClassName(line.className) : undefined}
            >
              {part.text}
            </span>
          ))
        : displayDiffLineText(line.text, line.className)}
    </span>
  );
}

function diffLineClassName(className: DiffLineClass): string {
  if (className === "added") return "codex-panel-diff__line codex-panel-diff__line--added";
  if (className === "context") return "codex-panel-diff__line codex-panel-diff__line--context";
  if (className === "file") return "codex-panel-diff__line codex-panel-diff__line--file";
  if (className === "hunk") return "codex-panel-diff__line codex-panel-diff__line--hunk";
  return "codex-panel-diff__line codex-panel-diff__line--removed";
}

function diffWordClassName(className: DiffLineClass): string {
  if (className === "added") return "codex-panel-diff__word codex-panel-diff__word--added";
  if (className === "removed") return "codex-panel-diff__word codex-panel-diff__word--removed";
  return "codex-panel-diff__word";
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
