import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { backtickDelimiter } from "../../../../domain/text/markdown";

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

export function markdownCodeSpan(text: string): string {
  const delimiter = backtickDelimiter(text, 1);
  if (delimiter.length === 1) return `\`${text}\``;
  return `${delimiter} ${text} ${delimiter}`;
}
