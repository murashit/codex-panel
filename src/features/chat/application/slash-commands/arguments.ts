import { shortThreadId, type Thread } from "../../../../domain/threads/model";
import { resolveThreadSearchQuery } from "../../../../domain/threads/search";
import { threadDisplayTitle } from "../../../../domain/threads/title";
import { isSlashCommandName, type SlashCommandName, slashCommandDefinition } from "./catalog";

export function parseSlashCommand(text: string): { command: SlashCommandName; args: string } | null {
  const match = /^\/([A-Za-z-]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const command = match[1];
  if (!command || !isSlashCommandName(command)) return null;
  return { command, args: match.at(2)?.trim() ?? "" };
}

export function parseWebCommandArgs(args: string): { url: string; message: string } | null {
  const match = /^(\S+)(?:\s+([\s\S]*\S))?\s*$/.exec(args);
  if (!match) return null;
  const url = match[1];
  const message = match[2] ?? "";
  return url !== undefined ? { url, message } : null;
}

export const THREAD_TITLE_COMMANDS = ["resume", "refer", "archive", "rename"] as const;

export type ThreadTitleCommand = (typeof THREAD_TITLE_COMMANDS)[number];

export interface ThreadCommandTarget {
  readonly command: ThreadTitleCommand;
  readonly threadId: string;
  readonly title: string;
}

export interface ParsedThreadTitleArgument {
  readonly title: string;
  readonly rest: string;
}

export function threadCommandTargetForDraft(draft: string, target: ThreadCommandTarget | null): ThreadCommandTarget | null {
  if (!target) return null;
  const command = parseSlashCommand(draft.trim());
  if (command?.command !== target.command) return null;
  const parsed = parseThreadTitleArgument(command.args);
  return parsed?.title === target.title ? target : null;
}

export function quotedThreadTitleArgument(title: string): string {
  return `"${title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function parseThreadTitleArgument(input: string): ParsedThreadTitleArgument | null {
  const source = input.trimStart();
  if (!source) return null;
  if (!source.startsWith('"')) {
    const match = /^(\S+)([\s\S]*)$/.exec(source);
    const title = match?.[1];
    const rest = match?.[2];
    return title === undefined || rest === undefined ? null : { title, rest: rest.trimStart() };
  }

  const { title, rest } = readQuotedTitle(source);
  if (rest === null || (rest && !/^\s/.test(rest))) return null;
  return { title, rest: rest.trimStart() };
}

export function partialThreadTitleQuery(input: string): string | null {
  if (!input.startsWith('"')) return /\s/.test(input) ? null : input;
  const { title, rest } = readQuotedTitle(input);
  return rest === null ? title : null;
}

// A null remainder means the closing quote has not been typed yet.
function readQuotedTitle(source: string): { title: string; rest: string | null } {
  let title = "";
  for (let index = 1; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "\\") {
      const escaped = source.charAt(index + 1);
      if (!escaped) break;
      if (escaped !== "\\" && escaped !== '"') title += "\\";
      title += escaped;
      index += 1;
      continue;
    }
    if (character === '"') return { title, rest: source.slice(index + 1) };
    title += character;
  }
  return { title, rest: null };
}

export function validateSlashCommandArguments(command: SlashCommandName, args: string): string | null {
  const definition = slashCommandDefinition(command);
  if (definition.argsKind === "none" && args) return usageError(command, "does not take arguments");
  if (definition.argsKind === "requiredThread" && !args) return usageError(command, "requires a thread");
  if (definition.argsKind === "threadAndMessage" && !parseThreadAndTextArgs(args))
    return usageError(command, "requires a thread and a message");
  if (definition.argsKind === "threadAndName" && !parseThreadAndTextArgs(args)) return usageError(command, "requires a thread and a name");
  if (definition.argsKind === "urlAndOptionalMessage" && !parseWebCommandArgs(args)) return usageError(command, "requires a URL");
  return null;
}

export function usageError(command: SlashCommandName, message: string): string {
  const definition = slashCommandDefinition(command);
  return `${definition.command} ${message}. Usage: ${definition.usage}`;
}

export function parseThreadAndTextArgs(args: string): { threadQuery: string; text: string } | null {
  const parsed = parseThreadTitleArgument(args);
  const text = parsed?.rest.trim();
  return parsed?.title.trim() && text ? { threadQuery: parsed.title, text } : null;
}

export function parseThreadOnlyArgs(args: string, options: { allowEmpty?: boolean } = {}): string | null {
  if (!args.trim()) return options.allowEmpty ? "" : null;
  const parsed = parseThreadTitleArgument(args);
  return parsed?.title.trim() && !parsed.rest ? parsed.title : null;
}

type ThreadResolution = { ok: true; thread: Thread } | { ok: false; message: string };

interface ThreadResolutionOptions {
  excludedThreadId?: string | null;
  allowExactExcludedThread?: boolean;
}

export function resolveThreadArgument(
  command: ThreadTitleCommand,
  args: string,
  threads: readonly Thread[],
  completedTarget: ThreadCommandTarget | undefined,
  options: ThreadResolutionOptions = {},
): ThreadResolution {
  const query = args.trim();
  if (completedTarget?.command === command && completedTarget.title === query) {
    const completedThread = threads.find((thread) => thread.id === completedTarget.threadId);
    return completedThread
      ? { ok: true, thread: completedThread }
      : { ok: false, message: `Completed thread is no longer available: ${completedTarget.title}` };
  }

  const searchThreads = options.excludedThreadId ? threads.filter((thread) => thread.id !== options.excludedThreadId) : threads;
  const resolution = resolveThreadSearchQuery(searchThreads, query);
  if (resolution.kind === "match") return { ok: true, thread: resolution.match.thread };
  if (resolution.kind === "multiple") return multipleThreadResolution(resolution.matches.map((match) => match.thread));
  const exactExcludedThread = options.allowExactExcludedThread
    ? threads.find(
        (thread) => thread.id === options.excludedThreadId && threadDisplayTitle(thread).trim().toLowerCase() === query.toLowerCase(),
      )
    : null;
  if (exactExcludedThread) return { ok: true, thread: exactExcludedThread };
  return { ok: false, message: query ? `No matching thread: ${query}` : "No recent threads to resume." };
}

function multipleThreadResolution(threads: readonly Thread[]): ThreadResolution {
  const matches = threads.map((thread) => `${threadDisplayTitle(thread)} (${shortThreadId(thread.id)})`).join(", ");
  return { ok: false, message: `Multiple matching threads: ${matches}` };
}
