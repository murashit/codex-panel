import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";

export type MarkdownCodeRange = readonly [start: number, end: number];

export function markdownCodeRanges(markdown: string): MarkdownCodeRange[] {
  const ranges: MarkdownCodeRange[] = [];
  visit(fromMarkdown(markdown), (node) => {
    if (node.type !== "code" && node.type !== "inlineCode") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) ranges.push([start, end]);
  });
  return ranges;
}

export function markdownCodeRangeContainsOffset(ranges: readonly MarkdownCodeRange[], offset: number): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}
