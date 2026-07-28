import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { Thread } from "../../../../domain/threads/model";
import type { SlashCommandName } from "../slash-commands/catalog";
import { activeSlashCommandSuggestions } from "../slash-commands/suggestions";
import {
  activeNoteContextReferenceMarker,
  type ComposerContextReferences,
  formatComposerContextRange,
  type SelectionContextReference,
  selectionContextReferenceMarker,
} from "./context-references";
import type { FuzzyMatch, FuzzyMatcher } from "./fuzzy-search";
import type { DailyNoteReferenceCandidate, NoteCandidate, NoteHeadingCandidate } from "./note-context";
import type { ComposerSuggestion } from "./suggestion";

export interface ComposerSuggestionOptions {
  activeThreadId?: string | null;
  slashCommandAvailable?: (command: SlashCommandName) => boolean;
  contextReferences?: ComposerContextReferences;
  dailyNoteReferences?: readonly DailyNoteReferenceCandidate[] | (() => readonly DailyNoteReferenceCandidate[]);
  permissionProfiles?: readonly RuntimePermissionProfileSummary[];
  tagCandidates?: readonly string[] | (() => readonly string[]);
  fuzzyMatcher: FuzzyMatcher;
}

interface NoteCandidateMatch {
  file: NoteCandidate;
  match: FuzzyMatch;
  mtime: number;
  basename: string;
  path: string;
}

const SELECTION_SUGGESTION_PREVIEW_LIMIT = 500;

export function activeComposerSuggestions(
  beforeCursor: string,
  notes: NoteCandidate[],
  skills: readonly SkillMetadata[],
  threads: readonly Thread[] = [],
  models: readonly ModelMetadata[] = [],
  currentModel: string | null = null,
  options: ComposerSuggestionOptions,
): ComposerSuggestion[] {
  const slashCommandAvailable = options.slashCommandAvailable ?? (() => true);
  const slashSuggestions = activeSlashCommandSuggestions(
    beforeCursor,
    threads,
    models,
    currentModel,
    options.activeThreadId ?? null,
    options.permissionProfiles ?? [],
    slashCommandAvailable,
  );
  return (
    activeWikiLinkSuggestions(beforeCursor, notes, options.fuzzyMatcher) ??
    activeContextReferenceSuggestions(beforeCursor, options.contextReferences, options.dailyNoteReferences) ??
    activeTagSuggestions(beforeCursor, options.tagCandidates ?? []) ??
    slashSuggestions ??
    activeSkillSuggestions(beforeCursor, skills) ??
    []
  );
}

function activeContextReferenceSuggestions(
  beforeCursor: string,
  references: ComposerContextReferences | undefined,
  dailyNoteReferences: readonly DailyNoteReferenceCandidate[] | (() => readonly DailyNoteReferenceCandidate[]) | undefined,
): ComposerSuggestion[] | null {
  const match = /(^|[\s([{])@([A-Za-z-]{0,120})$/.exec(beforeCursor);
  if (!match) return null;

  const rawQuery = match[2];
  if (rawQuery === undefined) return null;
  const query = rawQuery.toLowerCase();
  const start = beforeCursor.length - rawQuery.length - 1;
  const suggestions: ComposerSuggestion[] = [];
  if (references?.activeNote && "active".startsWith(query)) {
    suggestions.push({
      display: `Active · ${references.activeNote.name}`,
      detail: references.activeNote.path,
      replacement: activeNoteContextReferenceMarker(references.activeNote),
      start,
      activeNoteContext: references.activeNote,
    });
  }
  if (references?.selection && "selection".startsWith(query) && query !== "selection") {
    suggestions.push({
      display: `Selection · ${references.selection.name} · ${formatComposerContextRange(references.selection.range)}`,
      detail: selectionSuggestionPreview(references.selection),
      replacement: selectionContextReferenceMarker(references.selection),
      start,
      selectionContext: references.selection,
    });
  }
  const matchingDailyNotes = dailyNoteReferenceList(dailyNoteReferences).filter((candidate) => candidate.keyword.startsWith(query));
  suggestions.push(
    ...matchingDailyNotes.map((candidate) => ({
      display: `${candidate.display} · ${candidate.name}`,
      detail: candidate.path,
      replacement: `[[${candidate.linktext}]]`,
      start,
    })),
  );
  return suggestions.slice(0, 8);
}

function selectionSuggestionPreview(selection: SelectionContextReference): string {
  const preview = selection.text.replace(/\s+/g, " ").trim();
  return preview.length > SELECTION_SUGGESTION_PREVIEW_LIMIT ? `${preview.slice(0, SELECTION_SUGGESTION_PREVIEW_LIMIT - 1)}…` : preview;
}

function dailyNoteReferenceList(
  references: readonly DailyNoteReferenceCandidate[] | (() => readonly DailyNoteReferenceCandidate[]) | undefined,
): readonly DailyNoteReferenceCandidate[] {
  if (!references) return [];
  return typeof references === "function" ? references() : references;
}

export function applyComposerSuggestionInsertion(
  value: string,
  cursor: number,
  suggestion: ComposerSuggestion,
  options: { activation?: "enter" | "tab" } = {},
): { value: string; cursor: number } {
  const suffix = value.slice(cursor);
  const appendSpace = suggestion.appendSpaceOnInsert === true && !suggestion.replacement.endsWith(" ") && !/^\s/.test(suffix);
  const replacement = `${suggestion.replacement}${appendSpace ? " " : ""}`;
  const suffixStart =
    cursor + (suggestion.suffixOnInsert && suffix.startsWith(suggestion.suffixOnInsert) ? suggestion.suffixOnInsert.length : 0);
  const nextValue = `${value.slice(0, suggestion.start)}${replacement}${value.slice(suffixStart)}`;
  const cursorOffset = options.activation === "tab" ? (suggestion.tabCursorOffset ?? 0) : 0;
  return { value: nextValue, cursor: suggestion.start + replacement.length + cursorOffset };
}

export function composerSuggestionNavigationDirection(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): 1 | -1 | null {
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "n") return 1;
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "p") return -1;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  return null;
}

export function nextComposerSuggestionIndex(current: number, length: number, direction: 1 | -1): number {
  if (length <= 0) return 0;
  return (current + direction + length) % length;
}

export function composerSuggestionSignature(value: string, cursor: number): string {
  return `${value}\u0000${String(cursor)}`;
}

function activeWikiLinkSuggestions(beforeCursor: string, notes: NoteCandidate[], fuzzyMatcher: FuzzyMatcher): ComposerSuggestion[] | null {
  const start = beforeCursor.lastIndexOf("[[");
  if (start === -1) return null;

  const queryText = beforeCursor.slice(start + 2);
  if (queryText.includes("]]") || queryText.includes("\n") || queryText.length > 120) return null;
  return findWikiLinkSuggestions(queryText, start, notes, fuzzyMatcher);
}

function activeTagSuggestions(
  beforeCursor: string,
  tagCandidates: readonly string[] | (() => readonly string[]),
): ComposerSuggestion[] | null {
  const match = /(^|[\s[{])#([^\s\]})#]{0,120})$/.exec(beforeCursor);
  if (match?.index === undefined) return null;

  const prefix = match[1];
  const rawQuery = match[2];
  if (prefix === undefined || rawQuery === undefined) return null;
  const query = normalizeTag(rawQuery).toLowerCase();
  const normalizedTags = normalizedUniqueTags(tagCandidateList(tagCandidates));
  if (query.length > 0 && normalizedTags.some((tag) => tag.toLowerCase() === query)) return null;

  const start = match.index + prefix.length;
  return normalizedTags
    .map((tag) => ({ tag, lower: tag.toLowerCase() }))
    .filter(({ lower }) => query.length === 0 || lower.startsWith(query) || lower.includes(query))
    .sort((a, b) => tagSuggestionScore(a.lower, query) - tagSuggestionScore(b.lower, query) || a.tag.localeCompare(b.tag))
    .slice(0, 8)
    .map(({ tag }) => ({
      display: `#${tag}`,
      detail: "Obsidian tag",
      replacement: `#${tag}`,
      start,
      appendSpaceOnInsert: true,
    }));
}

function tagCandidateList(tagCandidates: readonly string[] | (() => readonly string[])): readonly string[] {
  return typeof tagCandidates === "function" ? tagCandidates() : tagCandidates;
}

function normalizedUniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedTags: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    normalizedTags.push(normalized);
  }
  return normalizedTags.sort((a, b) => a.localeCompare(b));
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "");
}

function tagSuggestionScore(tag: string, query: string): number {
  if (query.length === 0) return 0;
  return tag.startsWith(query) ? 0 : 1;
}

function findWikiLinkSuggestions(
  queryText: string,
  start: number,
  notes: NoteCandidate[],
  fuzzyMatcher: FuzzyMatcher,
): ComposerSuggestion[] {
  const headingCompletion = wikiLinkHeadingCompletion(queryText, start, notes, fuzzyMatcher);
  if (headingCompletion) return headingCompletion;

  const query = queryText.toLowerCase().trim();
  const suggestions = query.length === 0 ? emptyWikiLinkSuggestions(notes) : fuzzyWikiLinkSuggestions(query, notes, fuzzyMatcher);

  return suggestions.slice(0, 8).map(({ file }) => ({
    display: file.displayName,
    detail: file.path,
    replacement: `[[${file.linktext}]]`,
    start,
    tabCursorOffset: -2,
  }));
}

function wikiLinkHeadingCompletion(
  queryText: string,
  start: number,
  notes: NoteCandidate[],
  fuzzyMatcher: FuzzyMatcher,
): ComposerSuggestion[] | null {
  const blockIndex = queryText.indexOf("^");
  if (blockIndex !== -1) return [];

  const headingSeparator = queryText.indexOf("#");
  if (headingSeparator === -1) return null;

  const target = queryText.slice(0, headingSeparator).trim();
  if (!target) return [];

  const note = noteForWikiLinkTarget(target, notes);
  if (!note) return [];

  const query = queryText
    .slice(headingSeparator + 1)
    .trim()
    .toLowerCase();
  const headingMatches =
    query.length === 0 ? note.headings : fuzzyHeadingSuggestions(query, note.headings, fuzzyMatcher).map((item) => item.heading);
  return headingMatches.slice(0, 8).map((heading) => ({
    display: heading.heading,
    detail: `${"#".repeat(heading.level)} ${note.path}`,
    replacement: `[[${note.linktext}#${heading.linkHeading}]]`,
    start,
    suffixOnInsert: "]]",
  }));
}

function noteForWikiLinkTarget(target: string, notes: NoteCandidate[]): NoteCandidate | null {
  const normalized = target.toLowerCase();
  return notes.find((note) => wikiLinkTargetAliases(note).some((alias) => alias.toLowerCase() === normalized)) ?? null;
}

function wikiLinkTargetAliases(note: NoteCandidate): string[] {
  const aliases = [note.linktext, note.path, note.basename, note.displayName];
  if (note.path.toLowerCase().endsWith(".md")) aliases.push(note.path.slice(0, -3));
  return aliases;
}

function fuzzyHeadingSuggestions(
  query: string,
  headings: readonly NoteHeadingCandidate[],
  fuzzyMatcher: FuzzyMatcher,
): { heading: NoteHeadingCandidate; match: FuzzyMatch }[] {
  const search = fuzzyMatcher.prepare(query);
  const results = headings
    .map((heading) => {
      const match = search.match(heading.heading);
      return match ? { heading, match } : null;
    })
    .filter((item): item is { heading: NoteHeadingCandidate; match: FuzzyMatch } => item !== null);

  sortByFuzzyScore(results);
  return results;
}

function emptyWikiLinkSuggestions(notes: NoteCandidate[]): NoteCandidateMatch[] {
  return notes
    .filter((file) => file.recentIndex !== null)
    .map((file) => ({
      file,
      match: { score: 0 },
      mtime: -(file.recentIndex ?? 0),
      basename: file.basename,
      path: file.path,
    }))
    .sort(compareWikiLinkSuggestionTiebreakers);
}

function fuzzyWikiLinkSuggestions(query: string, notes: NoteCandidate[], fuzzyMatcher: FuzzyMatcher): NoteCandidateMatch[] {
  const search = fuzzyMatcher.prepare(query);
  const results = notes
    .map((file) => {
      const basenameMatch = search.match(file.basename);
      const pathMatch = search.match(file.path);
      const match = bestSearchResult(basenameMatch, pathMatch);
      return match ? { file, match, mtime: file.mtime, basename: file.basename, path: file.path } : null;
    })
    .filter((item): item is NoteCandidateMatch => item !== null);

  sortByFuzzyScore(results);
  return results.sort(compareWikiLinkSuggestionTiebreakers);
}

function bestSearchResult(a: FuzzyMatch | null, b: FuzzyMatch | null): FuzzyMatch | null {
  if (!a) return b;
  if (!b) return a;
  return a.score >= b.score ? a : b;
}

function sortByFuzzyScore(results: { match: FuzzyMatch }[]): void {
  results.sort((a, b) => b.match.score - a.match.score);
}

function compareWikiLinkSuggestionTiebreakers(a: NoteCandidateMatch, b: NoteCandidateMatch): number {
  if (a.match.score !== b.match.score) return 0;
  return b.mtime - a.mtime || a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path);
}

function activeSkillSuggestions(beforeCursor: string, skills: readonly SkillMetadata[]): ComposerSuggestion[] | null {
  const match = /(^|[\s([{])\$([^\s\])}]{0,120})$/.exec(beforeCursor);
  if (match?.index === undefined) return null;

  const prefix = match[1];
  const rawQuery = match[2];
  if (prefix === undefined || rawQuery === undefined) return null;
  const query = rawQuery.toLowerCase();
  if (skills.some((skill) => skill.name.toLowerCase() === query)) return null;
  const start = match.index + prefix.length;
  return skills
    .filter((skill) => skill.name.toLowerCase().includes(query))
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aScore = aName.startsWith(query) ? 0 : 1;
      const bScore = bName.startsWith(query) ? 0 : 1;
      return aScore - bScore || a.name.localeCompare(b.name);
    })
    .slice(0, 8)
    .map((skill) => ({
      display: `$${skill.name}`,
      detail: skill.shortDescription ?? skill.interfaceShortDescription ?? skill.description,
      replacement: `$${skill.name}`,
      start,
      appendSpaceOnInsert: true,
    }));
}
