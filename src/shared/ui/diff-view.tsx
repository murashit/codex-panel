import { diffWordsWithSpace, parsePatch, type StructuredPatch } from "diff";
import type { ComponentChild as UiNode } from "preact";

const MAX_INLINE_DIFF_CHARS = 4000;
const MAX_INLINE_DIFF_EDIT_LENGTH = 500;

export interface DiffDisplayLine {
  text: string;
  kind: "added" | "removed" | "context" | "hunk" | "file";
}

type DiffLineClass = DiffDisplayLine["kind"];

interface InlineDiffPart {
  text: string;
  changed: boolean;
}

interface InlineDiff {
  added: InlineDiffPart[];
  removed: InlineDiffPart[];
}

interface DiffLineView extends DiffDisplayLine {
  inlineParts: InlineDiffPart[] | null;
}

type ChangeLineClass = "added" | "removed";

export function unifiedDiffDisplayLines(diff: string): DiffDisplayLine[] {
  const patches = parsedGitPatches(diff);
  if (!patches) return rawDiffDisplayLines(diff);

  const displayLines: DiffDisplayLine[] = [];
  let inFileHeader = false;
  let patchIndex = 0;
  let hunkIndex = 0;
  let remainingHunkLines = 0;
  for (const line of diff.split("\n")) {
    if (remainingHunkLines > 0) {
      displayLines.push({ text: line, kind: line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "context" });
      remainingHunkLines -= 1;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const file = displayFilePath(patches[patchIndex]);
      patchIndex += 1;
      hunkIndex = 0;
      displayLines.push(file ? { text: file, kind: "file" } : { text: line, kind: "context" });
      inFileHeader = Boolean(file);
      continue;
    }
    if (line.startsWith("@@")) {
      inFileHeader = false;
      if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)) {
        remainingHunkLines = patches[patchIndex - 1]?.hunks[hunkIndex]?.lines.length ?? 0;
        hunkIndex += 1;
      }
    }
    if (inFileHeader && (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ "))) continue;
    displayLines.push({ text: line, kind: diffLineClassFromText(line) });
  }
  return displayLines;
}

export function UnifiedDiffView({ diff, className }: { diff: string; className?: string | undefined }): UiNode {
  return <DiffLineList lines={unifiedDiffDisplayLines(diff)} className={className} />;
}

export function DiffLineList({ lines, className }: { lines: readonly DiffDisplayLine[]; className?: string | undefined }): UiNode {
  return <DiffLineFrame lines={lines} className={className} />;
}

export function RawDiffView({ diff, className }: { diff: string; className?: string | undefined }): UiNode {
  return <DiffLineList lines={rawDiffDisplayLines(diff)} className={className} />;
}

function rawDiffDisplayLines(diff: string): DiffDisplayLine[] {
  return diff.split("\n").map((text) => ({ text, kind: diffLineClassFromText(text) }));
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

function parsedGitPatches(diff: string): readonly StructuredPatch[] | null {
  try {
    const patches = parsePatch(diff).filter((patch) => patch.isGit === true);
    return patches.length > 0 ? patches : null;
  } catch {
    return null;
  }
}

function displayFilePath(patch: StructuredPatch | undefined): string | null {
  if (!patch) return null;
  const fileName = patch.newFileName && patch.newFileName !== "/dev/null" ? patch.newFileName : patch.oldFileName;
  if (!fileName || fileName === "/dev/null") return null;
  return fileName.replace(/^[ab]\//, "");
}

function DiffLineFrame({ lines, className }: { lines: readonly DiffDisplayLine[]; className?: string | undefined }): UiNode {
  const preClassName = ["codex-panel-diff", className].filter(Boolean).join(" ");
  return (
    <pre className={preClassName}>
      {diffLineViews(lines).map((line, index) => (
        <DiffLine key={`${String(index)}:${line.kind}:${line.text}`} line={line} />
      ))}
    </pre>
  );
}

function diffLineViews(lines: readonly DiffDisplayLine[]): DiffLineView[] {
  const views: DiffLineView[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const changeClass = changeLineClass(line.kind);
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
  lines: readonly DiffDisplayLine[],
  startIndex: number,
  className: ChangeLineClass,
): { lines: DiffDisplayLine[]; endIndex: number } {
  const run: DiffDisplayLine[] = [];
  let index = startIndex;
  while (index < lines.length && lines[index]?.kind === className) {
    const line = lines[index];
    if (line) run.push(line);
    index += 1;
  }
  return { lines: run, endIndex: index };
}

function changeRunViews(firstRun: DiffDisplayLine[], secondRun: DiffDisplayLine[]): DiffLineView[] {
  const inlineDiffs = pairedInlineDiffs(firstRun, secondRun);
  const views: DiffLineView[] = [];
  for (let index = 0; index < firstRun.length; index += 1) {
    const line = firstRun[index];
    if (!line) continue;
    views.push({ ...line, inlineParts: inlinePartsForLine(line.kind, inlineDiffs[index] ?? null) });
  }
  for (let index = 0; index < secondRun.length; index += 1) {
    const line = secondRun[index];
    if (!line) continue;
    views.push({ ...line, inlineParts: inlinePartsForLine(line.kind, inlineDiffs[index] ?? null) });
  }
  return views;
}

function pairedInlineDiffs(firstRun: DiffDisplayLine[], secondRun: DiffDisplayLine[]): (InlineDiff | null)[] {
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

function inlineDiffForLines(firstLine: DiffDisplayLine, secondLine: DiffDisplayLine): InlineDiff | null {
  const removedLine = firstLine.kind === "removed" ? firstLine : secondLine;
  const addedLine = firstLine.kind === "added" ? firstLine : secondLine;
  return inlineDiff(displayDiffLineText(removedLine.text, removedLine.kind), displayDiffLineText(addedLine.text, addedLine.kind));
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
    <span className={diffLineClassName(line.kind)}>
      {line.inlineParts
        ? line.inlineParts.map((part, index) => (
            <span
              key={`${String(index)}:${part.changed ? "changed" : "same"}:${part.text}`}
              className={part.changed ? diffWordClassName(line.kind) : undefined}
            >
              {part.text}
            </span>
          ))
        : displayDiffLineText(line.text, line.kind)}
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

  const changes = diffWordsWithSpace(removedText, addedText, {
    maxEditLength: MAX_INLINE_DIFF_EDIT_LENGTH,
  });
  if (!changes) return null;

  const removed: InlineDiffPart[] = [];
  const added: InlineDiffPart[] = [];
  for (const change of changes) {
    const changed = change.added || change.removed;
    if (!change.added) removed.push({ text: change.value, changed });
    if (!change.removed) added.push({ text: change.value, changed });
  }

  return { added, removed };
}
