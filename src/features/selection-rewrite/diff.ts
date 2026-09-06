import { diffLines } from "diff";
import type { DiffDisplayLine } from "../../shared/ui/diff-view";

export function buildSelectionDiffLines(originalText: string, replacementText: string): DiffDisplayLine[] {
  const lines = lineChanges(withoutTrailingLineBreak(originalText), withoutTrailingLineBreak(replacementText));
  const originalHasTrailingLineBreak = hasTrailingLineBreak(originalText);
  const replacementHasTrailingLineBreak = hasTrailingLineBreak(replacementText);
  if (originalHasTrailingLineBreak !== replacementHasTrailingLineBreak) {
    lines.push({ text: `${originalHasTrailingLineBreak ? "-" : "+"}↵`, kind: originalHasTrailingLineBreak ? "removed" : "added" });
  }
  return lines.length > 0 ? lines : [{ text: " ", kind: "context" }];
}

const MAX_SELECTION_REWRITE_EDIT_LENGTH = 400;

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

function lineChanges(originalText: string, replacementText: string): DiffDisplayLine[] {
  const changes = diffLines(originalText, replacementText, {
    maxEditLength: MAX_SELECTION_REWRITE_EDIT_LENGTH,
    oneChangePerToken: true,
  });
  if (!changes) return linearLineChanges(textLines(originalText), textLines(replacementText));

  return changes.map((change) => {
    const prefix = change.added ? "+" : change.removed ? "-" : " ";
    const text = change.value.endsWith("\n") ? change.value.slice(0, -1) : change.value;
    return { text: `${prefix}${text}`, kind: change.added ? "added" : change.removed ? "removed" : "context" };
  });
}

function linearLineChanges(originalLines: string[], replacementLines: string[]): DiffDisplayLine[] {
  const prefixLength = commonPrefixLength(originalLines, replacementLines);
  const suffixLength = commonSuffixLength(originalLines, replacementLines, prefixLength);
  const changes: DiffDisplayLine[] = [];

  pushLines(changes, "context", originalLines, 0, prefixLength);
  pushLines(changes, "removed", originalLines, prefixLength, originalLines.length - suffixLength);
  pushLines(changes, "added", replacementLines, prefixLength, replacementLines.length - suffixLength);
  pushLines(changes, "context", originalLines, originalLines.length - suffixLength, originalLines.length);

  return changes;
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

function pushLines(changes: DiffDisplayLine[], kind: "context" | "added" | "removed", lines: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    changes.push({ text: `${kind === "added" ? "+" : kind === "removed" ? "-" : " "}${lines[index] ?? ""}`, kind });
  }
}
