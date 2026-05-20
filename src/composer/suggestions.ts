import type { Model } from "../generated/app-server/v2/Model";
import type { SkillMetadata } from "../generated/app-server/v2/SkillMetadata";
import type { Thread } from "../generated/app-server/v2/Thread";
import {
  findModelByIdOrName,
  isReasoningEffort,
  REASONING_EFFORTS,
  sortedAvailableModels,
  supportedEffortsForModel,
} from "../runtime/model";
import { SLASH_COMMANDS, type SlashCommandName } from "./slash-commands";
import { getThreadTitle } from "../threads/model";
import { shortThreadId } from "../utils";

export interface ComposerSuggestion {
  display: string;
  detail: string;
  replacement: string;
  start: number;
  appendSpaceOnInsert?: boolean;
}

export interface NoteCandidate {
  basename: string;
  path: string;
  mtime: number;
}

export function parseSlashCommand(text: string): { command: SlashCommandName; args: string } | null {
  const match = text.match(/^\/([A-Za-z-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const command = match[1] as SlashCommandName;
  if (!SLASH_COMMANDS.some((item) => item.command === `/${command}`)) return null;
  return { command, args: match[2]?.trim() ?? "" };
}

export function activeComposerSuggestions(
  beforeCursor: string,
  notes: NoteCandidate[],
  skills: SkillMetadata[],
  threads: Thread[] = [],
  models: Model[] = [],
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
  return `${value}\u0000${cursor}`;
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
  const basenameCounts = new Map<string, number>();
  for (const file of notes) {
    basenameCounts.set(file.basename, (basenameCounts.get(file.basename) ?? 0) + 1);
  }

  return notes
    .map((file) => {
      const basename = file.basename.toLowerCase();
      const path = file.path.toLowerCase();
      const score = query.length === 0 ? 3 : basename.startsWith(query) ? 0 : basename.includes(query) ? 1 : path.includes(query) ? 2 : -1;
      return { file, score };
    })
    .filter((item) => item.score !== -1)
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.file.mtime - a.file.mtime ||
        a.file.basename.localeCompare(b.file.basename) ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, 8)
    .map(({ file }) => {
      const duplicateBasename = (basenameCounts.get(file.basename) ?? 0) > 1;
      const target = duplicateBasename ? file.path.replace(/\.md$/i, "") : file.basename;
      return {
        display: file.basename,
        detail: file.path,
        replacement: `[[${target}]]`,
        start,
      };
    });
}

export function activeSlashCommandSuggestions(beforeCursor: string): ComposerSuggestion[] | null {
  const match = beforeCursor.match(/(?:^|\n)(\/[A-Za-z-]*)$/);
  if (!match || match.index === undefined) return null;

  const query = match[1].toLowerCase();
  if (SLASH_COMMANDS.some((item) => item.command.toLowerCase() === query)) return null;
  const start = match.index + match[0].lastIndexOf("/");
  return SLASH_COMMANDS.filter((item) => item.command.toLowerCase().startsWith(query))
    .slice(0, 8)
    .map((item) => ({
      display: item.command,
      detail: item.detail,
      replacement: item.command,
      start,
      appendSpaceOnInsert: true,
    }));
}

export function activeThreadCommandSuggestions(beforeCursor: string, threads: Thread[]): ComposerSuggestion[] | null {
  const match = beforeCursor.match(/(?:^|\n)\/(?:resume|refer|archive)\s+([^\s\n]{0,120})$/);
  if (!match || match.index === undefined) return null;

  const rawQuery = match[1] ?? "";
  const query = rawQuery.trim().toLowerCase();
  if (query.length > 0 && /\s$/.test(rawQuery)) return null;
  if (threads.some((thread) => thread.id.toLowerCase() === query)) return null;
  const start = beforeCursor.length - rawQuery.length;
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

export function activeModelOverrideSuggestions(beforeCursor: string, models: Model[]): ComposerSuggestion[] | null {
  const match = beforeCursor.match(/(?:^|\n)\/model\s+([^\n]{0,120})$/);
  if (!match || match.index === undefined) return null;

  const rawQuery = match[1] ?? "";
  const query = rawQuery.trim().toLowerCase();
  if (query.length > 0 && /\s$/.test(rawQuery)) return null;
  if (query === "default") return null;
  if (models.some((model) => !model.hidden && model.model.toLowerCase() === query)) return null;
  const start = beforeCursor.length - rawQuery.length;
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
  models: Model[],
  currentModel: string | null,
): ComposerSuggestion[] | null {
  const match = beforeCursor.match(/(?:^|\n)\/effort\s+([^\n]{0,120})$/);
  if (!match || match.index === undefined) return null;

  const rawQuery = match[1] ?? "";
  const query = rawQuery.trim().toLowerCase();
  if (query.length > 0 && /\s$/.test(rawQuery)) return null;
  if (query === "default" || isReasoningEffort(query)) return null;
  const start = beforeCursor.length - rawQuery.length;
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

export function activeSkillSuggestions(beforeCursor: string, skills: SkillMetadata[]): ComposerSuggestion[] | null {
  const match = beforeCursor.match(/(^|[\s([{])\$([^\s\])}]{0,120})$/);
  if (!match || match.index === undefined) return null;

  const prefix = match[1] ?? "";
  const query = (match[2] ?? "").toLowerCase();
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
