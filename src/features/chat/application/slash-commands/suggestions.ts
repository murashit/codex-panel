import type { ModelMetadata } from "../../../../domain/catalog/metadata";
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
import type { ComposerSuggestion } from "../composer/suggestion";
import { isSlashCommandName, SLASH_COMMANDS, type SlashCommandName, slashCommandSubcommands } from "./catalog";
import { partialThreadTitleQuery, quotedThreadTitleArgument, THREAD_TITLE_COMMANDS, type ThreadTitleCommand } from "./thread-arguments";

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

export function activeSlashCommandSuggestions(
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
    slashCommandNameSuggestions(beforeCursor, slashCommandAvailable) ??
    slashSubcommandSuggestions(beforeCursor, slashCommandAvailable) ??
    threadCommandSuggestions(beforeCursor, threads, activeThreadId) ??
    modelOverrideSuggestions(beforeCursor, models) ??
    reasoningEffortOverrideSuggestions(beforeCursor, models, currentModel) ??
    permissionProfileOverrideSuggestions(beforeCursor, permissionProfiles)
  );
}

function slashCommandNameSuggestions(
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

function slashSubcommandSuggestions(
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

function threadCommandSuggestions(
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
