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
