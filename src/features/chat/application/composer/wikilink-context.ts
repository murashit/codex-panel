import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import { type MarkdownCodeRange, markdownCodeRangeContainsOffset, markdownCodeRanges } from "../../../../domain/markdown/code-ranges";
import {
  ACTIVE_FILE_REFERENCE_NAME,
  codexTextInputWithReferences,
  type RequestAdditionalContext,
  type SkillReference,
  type VaultFileReference,
} from "../../../../domain/turns/input";
import {
  type ActiveNoteContextReference,
  type ComposerContextReferences,
  type SelectionContextReference,
  selectionContextReferenceMarker,
} from "./context-references";
import type { PreparedInput } from "./prepared-input";

interface ParsedWikiLink {
  raw: string;
  target: string;
  subpath: string;
  display: string;
}

interface ObsidianReference {
  marker: string;
  path: string;
  excerpt?: string;
}

export type WikiLinkFileReferenceResolver = (target: string) => VaultFileReference | null;

const OBSIDIAN_CONTEXT_ADDITIONAL_CONTEXT_KEY = "codex_panel_obsidian_context";
const WIKILINK_PATTERN = /\[\[([^\]\n]+?)\]\]/g;
const SKILL_REFERENCE_PATTERN = /(^|[\s([{])\$([^\s\])}.,;!?]{1,120})(?=$|[\s\])}.,;!?])/g;

interface PreparedComposerInputOptions {
  referenceActiveNoteOnSend: boolean;
}

function parsedWikiLinks(text: string, codeRanges: readonly MarkdownCodeRange[]): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    if (markdownCodeRangeContainsOffset(codeRanges, match.index)) continue;
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

export function preparedUserInputWithWikiLinkReferencesSkillsAndContext(
  text: string,
  resolveFileReference: WikiLinkFileReferenceResolver,
  skills: readonly SkillMetadata[],
  contextReferences: ComposerContextReferences,
  options: PreparedComposerInputOptions,
): PreparedInput {
  const codeRanges = markdownReferenceCodeRanges(text);
  const contextReplacement = textWithContextReferences(text, contextReferences, codeRanges);
  const resolvedText = contextReplacement.text;
  const fileReferences: VaultFileReference[] = [];
  const wikilinkReferences: ObsidianReference[] = [];
  const seenPaths = new Set<string>();
  const activeNoteSnapshots = contextReferences.activeNoteSnapshots ?? [];

  for (const link of parsedWikiLinks(resolvedText, codeRanges)) {
    const fileReference = activeNoteFileReferenceForLink(link, activeNoteSnapshots) ?? resolveFileReference(link.target);
    if (!fileReference || seenPaths.has(fileReference.path)) continue;
    seenPaths.add(fileReference.path);
    fileReferences.push(fileReference);
    wikilinkReferences.push({ marker: `[[${link.raw}]]`, path: fileReference.path });
  }

  for (const selection of contextReplacement.selections) {
    if (seenPaths.has(selection.path)) continue;
    seenPaths.add(selection.path);
    fileReferences.push({ name: selection.name, path: selection.path });
  }

  const attachedActiveNote = options.referenceActiveNoteOnSend ? contextReferences.activeNote : null;
  if (attachedActiveNote) fileReferences.push({ name: ACTIVE_FILE_REFERENCE_NAME, path: attachedActiveNote.path });

  const skillByName = firstEnabledSkillByName(skills);
  const resolvedSkills: SkillReference[] = [];
  const seenSkillPaths = new Set<string>();
  for (const reference of parsedSkillReferences(resolvedText, codeRanges)) {
    const skill = skillByName.get(reference.toLowerCase());
    if (!skill || seenSkillPaths.has(skill.path)) continue;
    seenSkillPaths.add(skill.path);
    resolvedSkills.push({ name: skill.name, path: skill.path });
  }

  return {
    text: resolvedText,
    input: codexTextInputWithReferences(
      resolvedText,
      fileReferences,
      resolvedSkills,
      additionalContext(wikilinkReferences, contextReplacement.selections, attachedActiveNote),
    ),
  };
}

function activeNoteFileReferenceForLink(link: ParsedWikiLink, snapshots: readonly ActiveNoteContextReference[]): VaultFileReference | null {
  const snapshot = snapshots.find((item) => link.raw.trim() === item.linktext && link.target === item.linktext);
  return snapshot ? { name: snapshot.name, path: snapshot.path } : null;
}

function textWithContextReferences(
  text: string,
  contextReferences: ComposerContextReferences,
  codeRanges: readonly MarkdownCodeRange[],
): { text: string; selections: SelectionContextReference[] } {
  return {
    text,
    selections: selectionsReferencedByText(text, contextReferences.selectionSnapshots ?? [], codeRanges),
  };
}

function selectionsReferencedByText(
  text: string,
  snapshots: readonly SelectionContextReference[],
  codeRanges: readonly MarkdownCodeRange[],
): SelectionContextReference[] {
  const selections: SelectionContextReference[] = [];
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const marker = selectionContextReferenceMarker(snapshot);
    if (!includesOutsideMarkdownCode(text, marker, codeRanges) || seen.has(marker)) continue;
    seen.add(marker);
    selections.push(snapshot);
  }
  return selections;
}

function additionalContext(
  wikilinkReferences: readonly ObsidianReference[],
  selections: readonly SelectionContextReference[],
  activeNote: ActiveNoteContextReference | null,
): RequestAdditionalContext[] {
  return obsidianContextAdditionalContext(obsidianReferences(wikilinkReferences, selections, activeNote));
}

function obsidianReferences(
  wikilinkReferences: readonly ObsidianReference[],
  selections: readonly SelectionContextReference[],
  activeNote: ActiveNoteContextReference | null,
): ObsidianReference[] {
  const selectionReferences = selections.map((selection) => ({
    marker: selectionContextReferenceMarker(selection),
    path: selection.path,
    excerpt: selection.text,
  }));
  const selectedWikilinks = new Set(selections.map((selection) => referenceKey(`[[${selection.linktext}]]`, selection.path)));
  return [
    ...wikilinkReferences.filter((reference) => !selectedWikilinks.has(referenceKey(reference.marker, reference.path))),
    ...selectionReferences,
    ...(activeNote ? [{ marker: ACTIVE_FILE_REFERENCE_NAME, path: activeNote.path }] : []),
  ];
}

function referenceKey(marker: string, path: string): string {
  return `${marker}\u0000${path}`;
}

function obsidianContextAdditionalContext(references: readonly ObsidianReference[]): RequestAdditionalContext[] {
  if (references.length === 0) return [];
  return [
    {
      key: OBSIDIAN_CONTEXT_ADDITIONAL_CONTEXT_KEY,
      kind: "untrusted",
      value: obsidianContextValue(references),
    },
  ];
}

function obsidianContextValue(references: readonly ObsidianReference[]): string {
  const excerpts = references.filter((reference): reference is ObsidianReference & { excerpt: string } => reference.excerpt !== undefined);
  return [
    "Obsidian references for the current user input:",
    ...references.map(referenceLine),
    ...(excerpts.length > 0 ? ["", "Inline excerpts:", ...excerptLines(excerpts)] : []),
  ].join("\n");
}

function referenceLine(reference: ObsidianReference): string {
  return `- ${reference.marker} -> ${reference.path}${reference.excerpt === undefined ? "" : " (inline excerpt below)"}`;
}

function excerptLines(references: readonly (ObsidianReference & { excerpt: string })[]): string[] {
  return references.flatMap((reference, index) => {
    const prefix = index === 0 ? [] : [""];
    return [...prefix, `${reference.marker}:`, reference.excerpt];
  });
}

function parsedSkillReferences(text: string, codeRanges: readonly MarkdownCodeRange[]): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(SKILL_REFERENCE_PATTERN)) {
    const prefix = match[1] ?? "";
    if (markdownCodeRangeContainsOffset(codeRanges, match.index + prefix.length)) continue;
    const name = match[2];
    if (name === undefined) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(name);
  }
  return references;
}

function markdownReferenceCodeRanges(text: string): MarkdownCodeRange[] {
  return text.includes("[[") || text.includes("$") ? markdownCodeRanges(text) : [];
}

function includesOutsideMarkdownCode(text: string, value: string, codeRanges: readonly MarkdownCodeRange[]): boolean {
  let index = text.indexOf(value);
  while (index >= 0) {
    if (!markdownCodeRangeContainsOffset(codeRanges, index)) return true;
    index = text.indexOf(value, index + value.length);
  }
  return false;
}

function parseWikiLink(raw: string): ParsedWikiLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const separator = trimmed.indexOf("|");
  const linktext = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
  const display = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
  if (!linktext) return null;

  const parsed = parseWikiLinkTarget(linktext);
  const target = parsed.path.trim();
  const subpath = parsed.subpath.trim();
  if (!target) return null;
  return { raw, target, subpath, display };
}

function parseWikiLinkTarget(linktext: string): { path: string; subpath: string } {
  const headingIndex = linktext.indexOf("#");
  const blockIndex = linktext.indexOf("^");
  const subpathStart = headingIndex === -1 ? blockIndex : blockIndex === -1 ? headingIndex : Math.min(headingIndex, blockIndex);
  return subpathStart === -1
    ? { path: linktext, subpath: "" }
    : { path: linktext.slice(0, subpathStart), subpath: linktext.slice(subpathStart) };
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
