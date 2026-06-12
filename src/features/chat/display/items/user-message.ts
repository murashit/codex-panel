import type { CodexInput, CodexInputItem } from "../../../../app-server/request-input";
import type { DisplayFileMention } from "../types";

type TextRange = [number, number];

export function fileMentionsFromInput(input: readonly CodexInputItem[]): DisplayFileMention[] {
  const seen = new Set<string>();
  const mentions: DisplayFileMention[] = [];
  for (const item of input) {
    if (item.type !== "mention" || seen.has(item.path)) continue;
    seen.add(item.path);
    mentions.push({ name: item.name, path: item.path });
  }
  return mentions;
}

export function userMessageDisplayText(text: string, input: CodexInput): string {
  const names = resolvedSkillNames(input);
  if (names.length === 0) return text;

  const pattern = new RegExp(`(^|[\\s([{])\\$(${names.map(escapeRegExp).join("|")})(?=$|[\\s\\])}.,;!?])`, "gi");
  const codeRanges = markdownCodeRanges(text);
  return text.replace(pattern, (match: string, prefix: string, name: string, offset: number) => {
    const dollarIndex = offset + prefix.length;
    return isIndexInRanges(dollarIndex, codeRanges) ? match : `${prefix}${markdownCodeSpan(`$${name}`)}`;
  });
}

function resolvedSkillNames(input: readonly CodexInputItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of input) {
    if (item.type !== "skill") continue;
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(item.name);
  }
  return names.sort((a, b) => b.length - a.length);
}

function markdownCodeSpan(text: string): string {
  if (!text.includes("`")) return `\`${text}\``;
  const longestRun = Math.max(...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  return `${delimiter} ${text} ${delimiter}`;
}

function markdownCodeRanges(text: string): TextRange[] {
  return [...markdownFenceRanges(text), ...markdownInlineCodeRanges(text)].sort((a, b) => a[0] - b[0]);
}

function markdownFenceRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let active: { marker: string; start: number } | null = null;
  let offset = 0;
  for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const value = line[0];
    if (value.length === 0) break;
    const fence = /^(?: {0,3})(`{3,}|~{3,})/.exec(value);
    if (fence) {
      const marker = fence[1];
      if (!marker) continue;
      if (!active) {
        active = { marker, start: offset };
      } else if (marker.startsWith(active.marker.charAt(0)) && marker.length >= active.marker.length) {
        ranges.push([active.start, offset + value.length]);
        active = null;
      }
    }
    offset += value.length;
  }
  if (active) ranges.push([active.start, text.length]);
  return ranges;
}

function markdownInlineCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const fenceRanges = markdownFenceRanges(text);
  let index = 0;
  while (index < text.length) {
    if (isIndexInRanges(index, fenceRanges) || text[index] !== "`") {
      index += 1;
      continue;
    }
    const match = /`+/.exec(text.slice(index));
    if (!match) {
      index += 1;
      continue;
    }
    const delimiter = match[0];
    const end = text.indexOf(delimiter, index + delimiter.length);
    if (end < 0) {
      index += delimiter.length;
      continue;
    }
    ranges.push([index, end + delimiter.length]);
    index = end + delimiter.length;
  }
  return ranges;
}

function isIndexInRanges(index: number, ranges: readonly TextRange[]): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
