export function buildSelectionUnifiedDiff(filePath: string, originalText: string, replacementText: string): string {
  const originalLines = textLines(originalText);
  const replacementLines = textLines(replacementText);
  const changes = lineChanges(originalLines, replacementLines);
  const oldCount = Math.max(originalLines.length, 1);
  const newCount = Math.max(replacementLines.length, 1);

  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${String(oldCount)} +1,${String(newCount)} @@`,
    ...changes.map((change) => `${change.prefix}${change.text}`),
  ].join("\n");
}

const MAX_SELECTION_REWRITE_LCS_CELLS = 40_000;

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
  if (originalLines.length * replacementLines.length > MAX_SELECTION_REWRITE_LCS_CELLS) {
    return linearLineChanges(originalLines, replacementLines);
  }

  const lengths = lcsLengths(originalLines, replacementLines);
  const changes: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < originalLines.length || newIndex < replacementLines.length) {
    if (oldIndex < originalLines.length && newIndex < replacementLines.length && originalLines[oldIndex] === replacementLines[newIndex]) {
      changes.push({ prefix: " ", text: originalLines[oldIndex] ?? "" });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < replacementLines.length &&
      (oldIndex === originalLines.length || (lengths[oldIndex]?.[newIndex + 1] ?? 0) > (lengths[oldIndex + 1]?.[newIndex] ?? 0))
    ) {
      changes.push({ prefix: "+", text: replacementLines[newIndex] ?? "" });
      newIndex += 1;
    } else if (oldIndex < originalLines.length) {
      changes.push({ prefix: "-", text: originalLines[oldIndex] ?? "" });
      oldIndex += 1;
    }
  }

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

function lcsLengths(left: string[], right: string[]): number[][] {
  const rows = Array.from({ length: left.length + 1 }, () => Array.from({ length: right.length + 1 }, () => 0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const row = rows[leftIndex];
      if (row === undefined) continue;
      row[rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? (rows[leftIndex + 1]?.[rightIndex + 1] ?? 0) + 1
          : Math.max(rows[leftIndex + 1]?.[rightIndex] ?? 0, rows[leftIndex]?.[rightIndex + 1] ?? 0);
    }
  }
  return rows;
}
