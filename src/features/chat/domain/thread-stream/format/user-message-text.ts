import { markdownCodeRangeContainsOffset, markdownCodeRanges } from "../../../../../domain/markdown/code-ranges";

interface UserMessageDisplayInputItem {
  type: string;
  name?: string;
}

export function userMessageDisplayText(text: string, input: readonly UserMessageDisplayInputItem[]): string {
  const names = resolvedSkillNames(input);
  if (names.length === 0) return text;

  const pattern = new RegExp(`(^|[\\s([{])\\$(${names.map(escapeRegExp).join("|")})(?=$|[\\s\\])}.,;!?])`, "gi");
  const codeRanges = markdownCodeRanges(text);
  return text.replace(pattern, (match: string, prefix: string, name: string, offset: number) => {
    const dollarIndex = offset + prefix.length;
    return markdownCodeRangeContainsOffset(codeRanges, dollarIndex) ? match : `${prefix}${markdownCodeSpan(`$${name}`)}`;
  });
}

function resolvedSkillNames(input: readonly UserMessageDisplayInputItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of input) {
    if (item.type !== "skill" || item.name === undefined) continue;
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

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
