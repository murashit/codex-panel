import { diffLines } from "diff";

export function buildSelectionDiffLines(originalText: string, replacementText: string): string[] {
  const changes = lineChanges(withoutTrailingLineBreak(originalText), withoutTrailingLineBreak(replacementText));
  const lines = changes.map((change) => `${change.prefix}${change.text}`);
  const originalHasTrailingLineBreak = hasTrailingLineBreak(originalText);
  const replacementHasTrailingLineBreak = hasTrailingLineBreak(replacementText);
  if (originalHasTrailingLineBreak !== replacementHasTrailingLineBreak) {
    lines.push(`${originalHasTrailingLineBreak ? "-" : "+"}↵`);
  }
  return lines.length > 0 ? lines : [" "];
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

function hasTrailingLineBreak(text: string): boolean {
  return text.endsWith("\n");
}

function withoutTrailingLineBreak(text: string): string {
  if (!hasTrailingLineBreak(text)) return text;
  return text.endsWith("\r\n") ? text.slice(0, -2) : text.slice(0, -1);
}

function lineChanges(originalText: string, replacementText: string): DiffLine[] {
  const changes = diffLines(originalText, replacementText, {
    maxEditLength: MAX_SELECTION_REWRITE_EDIT_LENGTH,
    oneChangePerToken: true,
  });
  if (!changes) return linearLineChanges(textLines(originalText), textLines(replacementText));

  const lines = changes.map<DiffLine>((change) => ({
    prefix: change.added ? "+" : change.removed ? "-" : " ",
    text: change.value.endsWith("\n") ? change.value.slice(0, -1) : change.value,
  }));

  return lines;
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
