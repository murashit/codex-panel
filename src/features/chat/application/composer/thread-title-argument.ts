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
  const match = /^\/([A-Za-z-]+)(?:\s+([\s\S]*))?$/.exec(draft.trim());
  if (match?.[1] !== target.command) return null;
  const parsed = parseThreadTitleArgument(match[2] ?? "");
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

  let title = "";
  for (let index = 1; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "\\") {
      const escaped = source.charAt(index + 1);
      if (!escaped) return null;
      if (escaped !== "\\" && escaped !== '"') title += "\\";
      title += escaped;
      index += 1;
      continue;
    }
    if (character === '"') {
      const rest = source.slice(index + 1);
      if (rest && !/^\s/.test(rest)) return null;
      return { title, rest: rest.trimStart() };
    }
    title += character;
  }
  return null;
}

export function partialThreadTitleQuery(input: string): string | null {
  if (!input.startsWith('"')) return /\s/.test(input) ? null : input;

  let query = "";
  for (let index = 1; index < input.length; index += 1) {
    const character = input.charAt(index);
    if (character === "\\") {
      const escaped = input.charAt(index + 1);
      if (!escaped) return query;
      if (escaped !== "\\" && escaped !== '"') query += "\\";
      query += escaped;
      index += 1;
      continue;
    }
    if (character === '"') return null;
    query += character;
  }
  return query;
}
