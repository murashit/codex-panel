import { shortThreadId } from "../../../../domain/threads/id";
import type { Thread } from "../../../../domain/threads/model";
import { resolveThreadSearchQuery } from "../../../../domain/threads/search";
import { threadDisplayTitle } from "../../../../domain/threads/title";
import { type SlashCommandName, slashCommandDefinition } from "./catalog";
import { parseWebCommandArgs } from "./parse";
import { parseThreadTitleArgument, type ThreadCommandTarget, type ThreadTitleCommand } from "./thread-arguments";

export function validateSlashCommandArguments(command: SlashCommandName, args: string): string | null {
  const definition = slashCommandDefinition(command);
  if (definition.argsKind === "none" && args) return usageError(command, "does not take arguments");
  if (definition.argsKind === "requiredThread" && !args) return usageError(command, "requires a thread");
  if (definition.argsKind === "threadAndMessage" && !parseReferArgs(args)) return usageError(command, "requires a thread and a message");
  if (definition.argsKind === "threadAndName" && !parseThreadAndNameArgs(args)) return usageError(command, "requires a thread and a name");
  if (definition.argsKind === "urlAndOptionalMessage" && !parseWebCommandArgs(args)) return usageError(command, "requires a URL");
  return null;
}

export function usageError(command: SlashCommandName, message: string): string {
  const definition = slashCommandDefinition(command);
  return `${definition.command} ${message}. Usage: ${definition.usage}`;
}

export function parseReferArgs(args: string): { threadQuery: string; message: string } | null {
  const parsed = parseThreadAndTextArgs(args);
  return parsed ? { threadQuery: parsed.threadQuery, message: parsed.text } : null;
}

export function parseThreadAndNameArgs(args: string): { threadQuery: string; text: string } | null {
  const parsed = parseThreadAndTextArgs(args);
  if (!parsed) return null;
  const text = parsed.text.trim();
  return text ? { threadQuery: parsed.threadQuery, text } : null;
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

function parseThreadAndTextArgs(args: string): { threadQuery: string; text: string } | null {
  const parsed = parseThreadTitleArgument(args);
  const text = parsed?.rest.trim();
  return parsed?.title.trim() && text ? { threadQuery: parsed.title, text } : null;
}

function multipleThreadResolution(threads: readonly Thread[]): ThreadResolution {
  const matches = threads.map((thread) => `${threadDisplayTitle(thread)} (${shortThreadId(thread.id)})`).join(", ");
  return { ok: false, message: `Multiple matching threads: ${matches}` };
}
