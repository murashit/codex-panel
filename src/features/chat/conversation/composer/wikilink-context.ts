import { codexTextInputWithMentions, type RequestMention } from "../../../../app-server/request-input";
import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import { parseObsidianWikiLink } from "../../../../shared/obsidian/wikilinks";

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

export function userInputWithWikiLinkMentions(text: string, resolveMention: WikiLinkMentionResolver) {
  return userInputWithWikiLinkMentionsAndSkills(text, resolveMention, []);
}

export function userInputWithWikiLinkMentionsAndSkills(
  text: string,
  resolveMention: WikiLinkMentionResolver,
  skills: readonly SkillMetadata[],
) {
  const mentions: RequestMention[] = [];
  const seenPaths = new Set<string>();

  for (const link of parsedWikiLinks(text)) {
    const mention = resolveMention(link.target);
    if (!mention || seenPaths.has(mention.path)) continue;
    seenPaths.add(mention.path);
    mentions.push(mention);
  }

  const skillByName = firstEnabledSkillByName(skills);
  const resolvedSkills: RequestMention[] = [];
  const seenSkillPaths = new Set<string>();
  for (const reference of parsedSkillReferences(text)) {
    const skill = skillByName.get(reference.toLowerCase());
    if (!skill || seenSkillPaths.has(skill.path)) continue;
    seenSkillPaths.add(skill.path);
    resolvedSkills.push({ name: skill.name, path: skill.path });
  }

  return codexTextInputWithMentions(text, mentions, resolvedSkills);
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
  const parsed = parseObsidianWikiLink(raw);
  return parsed ? { raw, ...parsed } : null;
}

function firstEnabledSkillByName(skills: readonly SkillMetadata[]): Map<string, SkillMetadata> {
  const byName = new Map<string, SkillMetadata>();
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const key = skill.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, skill);
  }
  return byName;
}
