import { diffArrays } from "diff";

export function buildSelectionDiffLines(originalText: string, replacementText: string): string[] {
  const originalLines = textLines(originalText);
  const replacementLines = textLines(replacementText);
  const changes = lineChanges(originalLines, replacementLines);
  return changes.map((change) => `${change.prefix}${change.text}`);
}

const MAX_SELECTION_REWRITE_EDIT_LENGTH = 400;

interface DiffLine {
  prefix: " " | "+" | "-";
  text: string;
}

function textLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function lineChanges(originalLines: string[], replacementLines: string[]): DiffLine[] {
  const arrayChanges = diffArrays(originalLines, replacementLines, {
    maxEditLength: MAX_SELECTION_REWRITE_EDIT_LENGTH,
  });
  if (!arrayChanges) return linearLineChanges(originalLines, replacementLines);

  const changes = arrayChanges.flatMap<DiffLine>((change) =>
    change.value.map((text) => ({
      prefix: change.added ? "+" : change.removed ? "-" : " ",
      text,
    })),
  );

  return changes.length > 0 ? changes : [{ prefix: " ", text: "" }];
}

function linearLineChanges(originalLines: string[], replacementLines: string[]): DiffLine[] {
  const prefixLength = commonPrefixLength(originalLines, replacementLines);
  const suffixLength = commonSuffixLength(originalLines, replacementLines, prefixLength);
  const changes: DiffLine[] = [];

  pushLines(changes, " ", originalLines, 0, prefixLength);
  pushLines(changes, "-", originalLines, prefixLength, originalLines.length - suffixLength);
  pushLines(changes, "+", replacementLines, prefixLength, replacementLines.length - suffixLength);
  pushLines(changes, " ", originalLines, originalLines.length - suffixLength, originalLines.length);

  return changes.length > 0 ? changes : [{ prefix: " ", text: "" }];
}

function commonPrefixLength(left: string[], right: string[]): number {
  let prefixLength = 0;
  while (prefixLength < left.length && prefixLength < right.length && left[prefixLength] === right[prefixLength]) {
    prefixLength += 1;
  }
  return prefixLength;
}

function commonSuffixLength(left: string[], right: string[], prefixLength: number): number {
  let suffixLength = 0;
  while (
    suffixLength < left.length - prefixLength &&
    suffixLength < right.length - prefixLength &&
    left[left.length - 1 - suffixLength] === right[right.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  return suffixLength;
}

function pushLines(changes: DiffLine[], prefix: DiffLine["prefix"], lines: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    changes.push({ prefix, text: lines[index] ?? "" });
  }
}
