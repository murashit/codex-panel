import type { Model } from "../../../generated/app-server/v2/Model";
import type { SkillMetadata } from "../../../generated/app-server/v2/SkillMetadata";
import type { Thread } from "../../../generated/app-server/v2/Thread";
import { prepareFuzzySearch, sortSearchResults, type SearchResult } from "obsidian";
import {
  findModelByIdOrName,
  isReasoningEffort,
  REASONING_EFFORTS,
  sortedAvailableModels,
  supportedEffortsForModel,
} from "../../../runtime/model";
import { SLASH_COMMANDS, SLASH_COMMAND_SURFACE_LABELS, type SlashCommandName } from "./slash-commands";
import { getThreadTitle } from "../../../domain/threads/model";
import { shortThreadId } from "../../../utils";

export interface ComposerSuggestion {
  display: string;
  detail: string;
  replacement: string;
  start: number;
  appendSpaceOnInsert?: boolean;
}

export interface NoteCandidate {
  basename: string;
  displayName: string;
  path: string;
  mtime: number;
  linktext: string;
  recentIndex: number | null;
}

interface NoteCandidateMatch {
  file: NoteCandidate;
  match: SearchResult;
  mtime: number;
  basename: string;
  path: string;
}

export function parseSlashCommand(text: string): { command: SlashCommandName; args: string } | null {
  const match = /^\/([A-Za-z-]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const command = match[1] as SlashCommandName;
  if (!SLASH_COMMANDS.some((item) => item.command === `/${command}`)) return null;
  return { command, args: match.at(2)?.trim() ?? "" };
}

export function activeComposerSuggestions(
  beforeCursor: string,
  notes: NoteCandidate[],
  skills: readonly SkillMetadata[],
  threads: readonly Thread[] = [],
  models: readonly Model[] = [],
  currentModel: string | null = null,
): ComposerSuggestion[] {
  return (
    activeWikiLinkSuggestions(beforeCursor, notes) ??
    activeThreadCommandSuggestions(beforeCursor, threads) ??
    activeModelOverrideSuggestions(beforeCursor, models) ??
    activeReasoningEffortSuggestions(beforeCursor, models, currentModel) ??
    activeSlashCommandSuggestions(beforeCursor) ??
    activeSkillSuggestions(beforeCursor, skills) ??
    []
  );
}

export function applyComposerSuggestionInsertion(
  value: string,
  cursor: number,
  suggestion: ComposerSuggestion,
): { value: string; cursor: number } {
  const suffix = value.slice(cursor);
  const appendSpace = suggestion.appendSpaceOnInsert === true && !suggestion.replacement.endsWith(" ") && !/^\s/.test(suffix);
  const replacement = `${suggestion.replacement}${appendSpace ? " " : ""}`;
  const nextValue = `${value.slice(0, suggestion.start)}${replacement}${suffix}`;
  return { value: nextValue, cursor: suggestion.start + replacement.length };
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

export function activeWikiLinkSuggestions(beforeCursor: string, notes: NoteCandidate[]): ComposerSuggestion[] | null {
  const start = beforeCursor.lastIndexOf("[[");
  if (start === -1) return null;

  const queryText = beforeCursor.slice(start + 2);
  if (queryText.includes("]]") || queryText.includes("\n") || queryText.length > 120) return null;
  return findWikiLinkSuggestions(queryText, start, notes);
}

export function findWikiLinkSuggestions(queryText: string, start: number, notes: NoteCandidate[]): ComposerSuggestion[] {
  const query = queryText.toLowerCase().trim();
  const suggestions = query.length === 0 ? emptyWikiLinkSuggestions(notes) : fuzzyWikiLinkSuggestions(query, notes);

  return suggestions.slice(0, 8).map(({ file }) => ({
    display: file.displayName,
    detail: file.path,
    replacement: `[[${file.linktext}]]`,
    start,
  }));
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

export function activeSlashCommandSuggestions(beforeCursor: string): ComposerSuggestion[] | null {
  const match = /^(\/[A-Za-z-]*)$/.exec(beforeCursor);
  if (match?.index === undefined) return null;

  const rawQuery = match[1];
  if (rawQuery === undefined) return null;
  const query = rawQuery.toLowerCase();
  if (SLASH_COMMANDS.some((item) => item.command.toLowerCase() === query)) return null;
  const start = match.index + match[0].lastIndexOf("/");
  return SLASH_COMMANDS.filter((item) => item.command.toLowerCase().startsWith(query))
    .slice(0, 8)
    .map((item) => ({
      display: item.command,
      detail: `${SLASH_COMMAND_SURFACE_LABELS[item.surface]}: ${item.usage} - ${item.detail}`,
      replacement: item.command,
      start,
      appendSpaceOnInsert: true,
    }));
}

export function activeThreadCommandSuggestions(beforeCursor: string, threads: readonly Thread[]): ComposerSuggestion[] | null {
  const completion = activeCommandArgumentCompletionQuery(beforeCursor, /^\/(?:resume|refer|archive)\s+([^\s\n]{0,120})$/);
  if (!completion) return null;

  const { query, start } = completion;
  if (threads.some((thread) => thread.id.toLowerCase() === query)) return null;
  return threads
    .map((thread, index) => {
      const title = getThreadTitle(thread);
      const id = thread.id.toLowerCase();
      const normalizedTitle = title.toLowerCase();
      const score = query.length === 0 ? 2 : id.startsWith(query) ? 0 : normalizedTitle.includes(query) ? 1 : id.includes(query) ? 2 : -1;
      return { thread, title, score, index };
    })
    .filter((item) => item.score !== -1)
    .sort((a, b) => a.score - b.score || a.index - b.index || a.title.localeCompare(b.title))
    .slice(0, 8)
    .map(({ thread, title }) => ({
      display: title,
      detail: shortThreadId(thread.id),
      replacement: thread.id,
      start,
      appendSpaceOnInsert: true,
    }));
}

export function activeModelOverrideSuggestions(beforeCursor: string, models: readonly Model[]): ComposerSuggestion[] | null {
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
    ...sortedAvailableModels(models)
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

export function activeReasoningEffortSuggestions(
  beforeCursor: string,
  models: readonly Model[],
  currentModel: string | null,
): ComposerSuggestion[] | null {
  const completion = activeCommandArgumentCompletionQuery(beforeCursor, /^\/effort\s+([^\n]{0,120})$/);
  if (!completion) return null;

  const { query, start } = completion;
  if (query === "default" || isReasoningEffort(query)) return null;
  const model = findModelByIdOrName(models, currentModel);
  const efforts = model ? supportedEffortsForModel(model) : REASONING_EFFORTS;
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
      detail: modelDetail,
      replacement: effort,
      start,
      appendSpaceOnInsert: true,
    })),
  ];

  return suggestions.filter((item) => item.display.toLowerCase().startsWith(query)).slice(0, 8);
}

function activeCommandArgumentCompletionQuery(beforeCursor: string, pattern: RegExp): { query: string; start: number } | null {
  const match = pattern.exec(beforeCursor);
  if (!match) return null;

  const rawQuery = match[1];
  if (rawQuery === undefined) return null;
  const query = rawQuery.trim().toLowerCase();
  if (query.length > 0 && /\s$/.test(rawQuery)) return null;
  return { query, start: beforeCursor.length - rawQuery.length };
}

export function activeSkillSuggestions(beforeCursor: string, skills: readonly SkillMetadata[]): ComposerSuggestion[] | null {
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
      detail: skill.shortDescription ?? skill.interface?.shortDescription ?? skill.description,
      replacement: `$${skill.name}`,
      start,
      appendSpaceOnInsert: true,
    }));
}
