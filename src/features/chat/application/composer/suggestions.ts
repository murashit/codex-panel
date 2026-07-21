import { prepareFuzzySearch, type SearchResult, sortSearchResults } from "obsidian";
import type { ModelMetadata, SkillMetadata } from "../../../../domain/catalog/metadata";
import {
  findModelMetadataByIdOrName,
  reasoningEffortDescriptionForModelMetadata,
  sortedModelMetadata,
  supportedEffortsForModelMetadata,
} from "../../../../domain/catalog/metadata";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import { shortThreadId } from "../../../../domain/threads/id";
import type { Thread } from "../../../../domain/threads/model";
import { compareThreadSearchMatches, threadSearchMatches } from "../../../../domain/threads/search";
import { threadCommandDisplayTitle } from "../../../../domain/threads/title";
import {
  type ActiveNoteContextReference,
  activeNoteContextReferenceMarker,
  type ComposerContextReferences,
  formatComposerContextRange,
  type SelectionContextReference,
  selectionContextReferenceMarker,
} from "./context-references";
import type { DailyNoteReferenceCandidate, NoteCandidate, NoteHeadingCandidate } from "./note-context";
import { isSlashCommandName, SLASH_COMMANDS, type SlashCommandName, slashCommandSubcommands } from "./slash-commands";
import {
  partialThreadTitleQuery,
  quotedThreadTitleArgument,
  THREAD_TITLE_COMMANDS,
  type ThreadCommandTarget,
  type ThreadTitleCommand,
} from "./thread-title-argument";

export interface ComposerSuggestion {
  display: string;
  detail: string;
  replacement: string;
  start: number;
  appendSpaceOnInsert?: boolean;
  tabCursorOffset?: number;
  suffixOnInsert?: string;
  activeNoteContext?: ActiveNoteContextReference;
  selectionContext?: SelectionContextReference;
  threadCommandTarget?: ThreadCommandTarget;
}

export interface ComposerSuggestionOptions {
  activeThreadId?: string | null;
  slashCommandAvailable?: (command: SlashCommandName) => boolean;
  contextReferences?: ComposerContextReferences;
  dailyNoteReferences?: readonly DailyNoteReferenceCandidate[] | (() => readonly DailyNoteReferenceCandidate[]);
  permissionProfiles?: readonly RuntimePermissionProfileSummary[];
  tagCandidates?: readonly string[] | (() => readonly string[]);
}

interface NoteCandidateMatch {
  file: NoteCandidate;
  match: SearchResult;
  mtime: number;
  basename: string;
  path: string;
}

interface ThreadCommandSuggestionPolicy {
  excludeActiveThread: boolean;
  prioritizeActiveThreadForEmptyQuery: boolean;
}

const THREAD_COMMAND_SUGGESTION_POLICIES: Record<ThreadTitleCommand, ThreadCommandSuggestionPolicy> = {
  resume: {
    excludeActiveThread: true,
    prioritizeActiveThreadForEmptyQuery: false,
  },
  refer: {
    excludeActiveThread: true,
    prioritizeActiveThreadForEmptyQuery: false,
  },
  archive: {
    excludeActiveThread: false,
    prioritizeActiveThreadForEmptyQuery: true,
  },
  rename: {
    excludeActiveThread: false,
    prioritizeActiveThreadForEmptyQuery: true,
  },
};

const THREAD_SUGGESTION_COMMAND_PATTERN = new RegExp(`^/(${THREAD_TITLE_COMMANDS.join("|")})\\s+([^\\n]{0,120})$`);
const SELECTION_SUGGESTION_PREVIEW_LIMIT = 500;

export function parseSlashCommand(text: string): { command: SlashCommandName; args: string } | null {
  const match = /^\/([A-Za-z-]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const command = match[1];
  if (!command || !isSlashCommandName(command)) return null;
  return { command, args: match.at(2)?.trim() ?? "" };
}

export function activeComposerSuggestions(
  beforeCursor: string,
  notes: NoteCandidate[],
  skills: readonly SkillMetadata[],
  threads: readonly Thread[] = [],
  models: readonly ModelMetadata[] = [],
  currentModel: string | null = null,
  options: ComposerSuggestionOptions = {},
): ComposerSuggestion[] {
  const slashCommandAvailable = options.slashCommandAvailable ?? (() => true);
  const slashSuggestions = slashSuggestionsForActivePanel(
    beforeCursor,
    threads,
    models,
    currentModel,
    options.activeThreadId ?? null,
    options.permissionProfiles ?? [],
    slashCommandAvailable,
  );
  return (
    activeWikiLinkSuggestions(beforeCursor, notes) ??
    activeContextReferenceSuggestions(beforeCursor, options.contextReferences, options.dailyNoteReferences) ??
    activeTagSuggestions(beforeCursor, options.tagCandidates ?? []) ??
    slashSuggestions ??
    activeSkillSuggestions(beforeCursor, skills) ??
    []
  );
}

function slashSuggestionsForActivePanel(
  beforeCursor: string,
  threads: readonly Thread[],
  models: readonly ModelMetadata[],
  currentModel: string | null,
  activeThreadId: string | null,
  permissionProfiles: readonly RuntimePermissionProfileSummary[],
  slashCommandAvailable: (command: SlashCommandName) => boolean,
): ComposerSuggestion[] | null {
  const command = /^\/([A-Za-z-]+)/.exec(beforeCursor)?.[1];
  if (command && isSlashCommandName(command) && !slashCommandAvailable(command)) return [];
  return (
    activeSlashSubcommandSuggestions(beforeCursor, slashCommandAvailable) ??
    activeThreadCommandSuggestions(beforeCursor, threads, activeThreadId) ??
    modelOverrideSuggestions(beforeCursor, models) ??
    reasoningEffortOverrideSuggestions(beforeCursor, models, currentModel) ??
    permissionProfileOverrideSuggestions(beforeCursor, permissionProfiles) ??
    activeSlashCommandSuggestions(beforeCursor, slashCommandAvailable)
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

function activeWikiLinkSuggestions(beforeCursor: string, notes: NoteCandidate[]): ComposerSuggestion[] | null {
  const start = beforeCursor.lastIndexOf("[[");
  if (start === -1) return null;

  const queryText = beforeCursor.slice(start + 2);
  if (queryText.includes("]]") || queryText.includes("\n") || queryText.length > 120) return null;
  return findWikiLinkSuggestions(queryText, start, notes);
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

function findWikiLinkSuggestions(queryText: string, start: number, notes: NoteCandidate[]): ComposerSuggestion[] {
  const headingCompletion = wikiLinkHeadingCompletion(queryText, start, notes);
  if (headingCompletion) return headingCompletion;

  const query = queryText.toLowerCase().trim();
  const suggestions = query.length === 0 ? emptyWikiLinkSuggestions(notes) : fuzzyWikiLinkSuggestions(query, notes);

  return suggestions.slice(0, 8).map(({ file }) => ({
    display: file.displayName,
    detail: file.path,
    replacement: `[[${file.linktext}]]`,
    start,
    tabCursorOffset: -2,
  }));
}

function wikiLinkHeadingCompletion(queryText: string, start: number, notes: NoteCandidate[]): ComposerSuggestion[] | null {
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
  const headingMatches = query.length === 0 ? note.headings : fuzzyHeadingSuggestions(query, note.headings).map((item) => item.heading);
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
): { heading: NoteHeadingCandidate; match: SearchResult }[] {
  const search = prepareFuzzySearch(query);
  const results = headings
    .map((heading) => {
      const match = search(heading.heading);
      return match ? { heading, match } : null;
    })
    .filter((item): item is { heading: NoteHeadingCandidate; match: SearchResult } => item !== null);

  sortSearchResults(results);
  return results;
}

function emptyWikiLinkSuggestions(notes: NoteCandidate[]): NoteCandidateMatch[] {
  return notes
    .filter((file) => file.recentIndex !== null)
    .map((file) => ({
      file,
      match: { score: 0, matches: [] },
      mtime: -(file.recentIndex ?? 0),
      basename: file.basename,
      path: file.path,
    }))
    .sort(compareWikiLinkSuggestionTiebreakers);
}

function fuzzyWikiLinkSuggestions(query: string, notes: NoteCandidate[]): NoteCandidateMatch[] {
  const search = prepareFuzzySearch(query);
  const results = notes
    .map((file) => {
      const basenameMatch = search(file.basename);
      const pathMatch = search(file.path);
      const match = bestSearchResult(basenameMatch, pathMatch);
      return match ? { file, match, mtime: file.mtime, basename: file.basename, path: file.path } : null;
    })
    .filter((item): item is NoteCandidateMatch => item !== null);

  sortSearchResults(results);
  return results.sort(compareWikiLinkSuggestionTiebreakers);
}

function bestSearchResult(a: SearchResult | null, b: SearchResult | null): SearchResult | null {
  if (!a) return b;
  if (!b) return a;
  const ranked = [{ match: a }, { match: b }];
  sortSearchResults(ranked);
  return ranked[0]?.match ?? a;
}

function compareWikiLinkSuggestionTiebreakers(a: NoteCandidateMatch, b: NoteCandidateMatch): number {
  if (a.match.score !== b.match.score) return 0;
  return b.mtime - a.mtime || a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path);
}

function activeSlashCommandSuggestions(
  beforeCursor: string,
  slashCommandAvailable: (command: SlashCommandName) => boolean,
): ComposerSuggestion[] | null {
  const match = /^(\/[A-Za-z-]*)$/.exec(beforeCursor);
  if (match?.index === undefined) return null;

  const rawQuery = match[1];
  if (rawQuery === undefined) return null;
  const query = rawQuery.toLowerCase();
  if (SLASH_COMMANDS.some((item) => item.command.toLowerCase() === query)) return null;
  const start = match.index + match[0].lastIndexOf("/");
  return SLASH_COMMANDS.filter(
    (item) => item.command.toLowerCase().startsWith(query) && slashCommandAvailable(item.command.slice(1) as SlashCommandName),
  )
    .slice(0, 8)
    .map((item) => ({
      display: item.command,
      detail: `${item.usage} - ${item.detail}`,
      replacement: item.command,
      start,
      appendSpaceOnInsert: true,
    }));
}

function activeSlashSubcommandSuggestions(
  beforeCursor: string,
  slashCommandAvailable: (command: SlashCommandName) => boolean,
): ComposerSuggestion[] | null {
  const match = /^\/([A-Za-z-]+)\s+([A-Za-z-]{0,120})$/.exec(beforeCursor);
  if (!match) return null;

  const command = match[1];
  const rawQuery = match[2];
  if (!command || !isSlashCommandName(command) || rawQuery === undefined) return null;
  if (!slashCommandAvailable(command)) return [];

  const query = rawQuery.toLowerCase();
  const subcommands = slashCommandSubcommands(command);
  if (subcommands.length === 0) return null;
  if (subcommands.some((item) => item.subcommand.toLowerCase() === query)) return null;
  const start = beforeCursor.length - rawQuery.length;
  return subcommands
    .filter((item) => item.subcommand.toLowerCase().startsWith(query))
    .slice(0, 8)
    .map((item) => ({
      display: item.subcommand,
      detail: `${item.usage} - ${item.detail}`,
      replacement: item.subcommand,
      start,
      appendSpaceOnInsert: true,
    }));
}

function activeThreadCommandSuggestions(
  beforeCursor: string,
  threads: readonly Thread[],
  activeThreadId: string | null,
): ComposerSuggestion[] | null {
  const completion = activeThreadCommandCompletionQuery(beforeCursor);
  if (!completion) return null;

  const { command, query, start } = completion;
  const policy = THREAD_COMMAND_SUGGESTION_POLICIES[command];
  const candidateThreads = threads.filter((thread) => !shouldExcludeActiveThreadSuggestion(policy, thread.id, activeThreadId));

  return threadSearchMatches(candidateThreads, query)
    .map((match) => {
      const activePriority = activeThreadSuggestionPriority(policy, query, match.thread.id, activeThreadId);
      return { ...match, activePriority };
    })
    .sort((a, b) => a.activePriority - b.activePriority || compareThreadSearchMatches(a, b))
    .map(({ thread }) => {
      const title = threadCommandDisplayTitle(thread);
      return {
        display: title,
        detail: shortThreadId(thread.id),
        replacement: quotedThreadTitleArgument(title),
        start,
        appendSpaceOnInsert: true,
        threadCommandTarget: { command, threadId: thread.id, title },
      };
    });
}

function shouldExcludeActiveThreadSuggestion(
  policy: ThreadCommandSuggestionPolicy,
  threadId: string,
  activeThreadId: string | null,
): boolean {
  return policy.excludeActiveThread && activeThreadId !== null && threadId === activeThreadId;
}

function activeThreadSuggestionPriority(
  policy: ThreadCommandSuggestionPolicy,
  query: string,
  threadId: string,
  activeThreadId: string | null,
): number {
  return policy.prioritizeActiveThreadForEmptyQuery && query.length === 0 && activeThreadId !== null && threadId === activeThreadId ? 0 : 1;
}

function activeThreadCommandCompletionQuery(beforeCursor: string): { command: ThreadTitleCommand; query: string; start: number } | null {
  const match = THREAD_SUGGESTION_COMMAND_PATTERN.exec(beforeCursor);
  if (!match) return null;

  const command = threadSuggestionCommand(match[1]);
  const rawQuery = match[2];
  if (!command || rawQuery === undefined) return null;
  const query = partialThreadTitleQuery(rawQuery);
  if (query === null) return null;
  return { command, query, start: beforeCursor.length - rawQuery.length };
}

function threadSuggestionCommand(value: string | undefined): ThreadTitleCommand | null {
  return THREAD_TITLE_COMMANDS.find((command) => command === value) ?? null;
}

function modelOverrideSuggestions(beforeCursor: string, models: readonly ModelMetadata[]): ComposerSuggestion[] | null {
  const completion = activeCommandArgumentCompletionQuery(beforeCursor, /^\/model\s+([^\n]{0,120})$/);
  if (!completion) return null;

  const { query, start } = completion;
  if (query === "default") return null;
  if (models.some((model) => !model.hidden && model.model.toLowerCase() === query)) return null;
  const suggestions = [
    {
      display: "default",
      detail: "Reset model override",
      replacement: "default",
      start,
      appendSpaceOnInsert: true,
    },
    ...sortedModelMetadata(models)
      .map((model, index) => {
        const id = model.id.toLowerCase();
        const name = model.model.toLowerCase();
        const displayName = model.displayName.toLowerCase();
        const score = query.length === 0 ? 2 : name.startsWith(query) ? 0 : displayName.includes(query) ? 1 : id.includes(query) ? 2 : -1;
        return { model, score, index };
      })
      .filter((item) => item.score !== -1)
      .sort((a, b) => a.score - b.score || a.index - b.index || a.model.model.localeCompare(b.model.model))
      .map(({ model }) => ({
        display: model.model,
        detail: model.displayName || model.description,
        replacement: model.model,
        start,
        appendSpaceOnInsert: true,
      })),
  ];

  return suggestions
    .filter((item) => query.length === 0 || item.display.toLowerCase().startsWith(query) || item.detail.toLowerCase().includes(query))
    .slice(0, 8);
}

function reasoningEffortOverrideSuggestions(
  beforeCursor: string,
  models: readonly ModelMetadata[],
  currentModel: string | null,
): ComposerSuggestion[] | null {
  const completion = activeCommandArgumentCompletionQuery(beforeCursor, /^\/reasoning\s+([^\n]{0,120})$/);
  if (!completion) return null;

  const { query, start } = completion;
  const model = findModelMetadataByIdOrName(models, currentModel);
  const efforts = model ? supportedEffortsForModelMetadata(model) : [];
  if (query === "default" || efforts.includes(query)) return null;
  const modelDetail = model ? `Supported by ${model.model}` : "Supported reasoning effort";
  const suggestions = [
    {
      display: "default",
      detail: "Reset effort override",
      replacement: "default",
      start,
      appendSpaceOnInsert: true,
    },
    ...efforts.map((effort) => ({
      display: effort,
      detail: reasoningEffortDescriptionForModelMetadata(model, effort) ?? modelDetail,
      replacement: effort,
      start,
      appendSpaceOnInsert: true,
    })),
  ];

  return suggestions.filter((item) => item.display.toLowerCase().startsWith(query)).slice(0, 8);
}

function permissionProfileOverrideSuggestions(
  beforeCursor: string,
  profiles: readonly RuntimePermissionProfileSummary[],
): ComposerSuggestion[] | null {
  const completion = activeCommandArgumentCompletionQuery(beforeCursor, /^\/permissions\s+([^\n]{0,120})$/);
  if (!completion) return null;

  const { query, rawQuery, start } = completion;
  const allowedProfiles = profiles.filter((profile) => profile.allowed);
  if (query === "default" || allowedProfiles.some((profile) => profile.id === rawQuery)) return null;
  const suggestions = [
    {
      display: "default",
      detail: "Reset permission profile",
      replacement: "default",
      start,
      appendSpaceOnInsert: true,
    },
    ...allowedProfiles.map((profile) => ({
      display: profile.id,
      detail: profile.description ?? "Permission profile",
      replacement: profile.id,
      start,
      appendSpaceOnInsert: true,
    })),
  ];

  return permissionProfileSuggestionsForQuery(suggestions, query).slice(0, 8);
}

function permissionProfileSuggestionsForQuery(suggestions: ComposerSuggestion[], query: string): ComposerSuggestion[] {
  if (query.length === 0) return suggestions;

  return suggestions
    .map((suggestion) => ({ suggestion, score: permissionProfileSuggestionScore(suggestion, query) }))
    .filter((item): item is { suggestion: ComposerSuggestion; score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score)
    .map((item) => item.suggestion);
}

function permissionProfileSuggestionScore(suggestion: ComposerSuggestion, query: string): number | null {
  if (suggestion.display.toLowerCase().startsWith(query)) return 0;
  if (suggestion.display === "default") return null;
  return suggestion.detail.toLowerCase().includes(query) ? 1 : null;
}

function activeCommandArgumentCompletionQuery(
  beforeCursor: string,
  pattern: RegExp,
): { query: string; rawQuery: string; start: number } | null {
  const match = pattern.exec(beforeCursor);
  if (!match) return null;

  const rawQuery = match[1];
  if (rawQuery === undefined) return null;
  const trimmedQuery = rawQuery.trim();
  const query = trimmedQuery.toLowerCase();
  if (query.length > 0 && /\s$/.test(rawQuery)) return null;
  return { query, rawQuery: trimmedQuery, start: beforeCursor.length - rawQuery.length };
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
