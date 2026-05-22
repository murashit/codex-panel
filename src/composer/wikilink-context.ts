import type { SkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { UserInput } from "../generated/app-server/v2/UserInput";

export interface ParsedWikiLink {
  raw: string;
  target: string;
  subpath: string;
  display: string;
}

export type WikiLinkMentionResolver = (target: string) => { name: string; path: string } | null;

const WIKILINK_PATTERN = /\[\[([^\]\n]+?)\]\]/g;
const SKILL_REFERENCE_PATTERN = /(^|[\s([{])\$([^\s\])}.,;!?]{1,120})(?=$|[\s\])}.,;!?])/g;

export function parsedWikiLinks(text: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const rawValue = match[1];
    if (rawValue === undefined) continue;
    const raw = rawValue.trim();
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
  return userInputWithWikiLinkMentionsAndSkills(text, resolveMention, []);
}

export function userInputWithWikiLinkMentionsAndSkills(
  text: string,
  resolveMention: WikiLinkMentionResolver,
  skills: SkillMetadata[],
): UserInput[] {
  const input: UserInput[] = [{ type: "text", text, text_elements: [] }];
  const seenPaths = new Set<string>();

  for (const link of parsedWikiLinks(text)) {
    const mention = resolveMention(link.target);
    if (!mention || seenPaths.has(mention.path)) continue;
    seenPaths.add(mention.path);
    input.push({ type: "mention", name: mention.name, path: mention.path });
  }

  const skillByName = firstEnabledSkillByName(skills);
  const seenSkillPaths = new Set<string>();
  for (const reference of parsedSkillReferences(text)) {
    const skill = skillByName.get(reference.toLowerCase());
    if (!skill || seenSkillPaths.has(skill.path)) continue;
    seenSkillPaths.add(skill.path);
    input.push({ type: "skill", name: skill.name, path: skill.path });
  }

  return input;
}

export function parsedSkillReferences(text: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(SKILL_REFERENCE_PATTERN)) {
    const name = match[2];
    if (name === undefined) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(name);
  }
  return references;
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

function firstEnabledSkillByName(skills: SkillMetadata[]): Map<string, SkillMetadata> {
  const byName = new Map<string, SkillMetadata>();
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const key = skill.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, skill);
  }
  return byName;
}
