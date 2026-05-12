import type { UserInput } from "../generated/app-server/v2/UserInput";

export interface ParsedWikiLink {
  raw: string;
  target: string;
  subpath: string;
  display: string;
}

export type WikiLinkMentionResolver = (target: string) => { name: string; path: string } | null;

const WIKILINK_PATTERN = /\[\[([^\]\n]+?)\]\]/g;

export function parsedWikiLinks(text: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const raw = match[1]?.trim() ?? "";
    const link = parseWikiLink(raw);
    if (!link) continue;
    const key = `${link.target}${link.subpath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}

export function userInputWithWikiLinkMentions(text: string, resolveMention: WikiLinkMentionResolver): UserInput[] {
  const input: UserInput[] = [{ type: "text", text, text_elements: [] }];
  const seenPaths = new Set<string>();

  for (const link of parsedWikiLinks(text)) {
    const mention = resolveMention(link.target);
    if (!mention || seenPaths.has(mention.path)) continue;
    seenPaths.add(mention.path);
    input.push({ type: "mention", name: mention.name, path: mention.path });
  }

  return input;
}

function parseWikiLink(raw: string): ParsedWikiLink | null {
  const separator = raw.indexOf("|");
  const linkPart = (separator === -1 ? raw : raw.slice(0, separator)).trim();
  const display = separator === -1 ? "" : raw.slice(separator + 1).trim();
  if (!linkPart) return null;

  const subpathStart = firstSubpathIndex(linkPart);
  const target = subpathStart === -1 ? linkPart : linkPart.slice(0, subpathStart).trim();
  const subpath = subpathStart === -1 ? "" : linkPart.slice(subpathStart).trim();
  if (!target) return null;
  return { raw, target, subpath, display };
}

function firstSubpathIndex(linkPart: string): number {
  const headingIndex = linkPart.indexOf("#");
  const blockIndex = linkPart.indexOf("^");
  if (headingIndex === -1) return blockIndex;
  if (blockIndex === -1) return headingIndex;
  return Math.min(headingIndex, blockIndex);
}
