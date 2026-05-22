import type { Thread } from "../generated/app-server/v2/Thread";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import { inputToText, shortThreadId } from "../utils";
import { getThreadTitle } from "./model";

export const REFERENCED_THREAD_TURN_LIMIT = 20;

export interface ReferencedThreadDisplay {
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
}

export interface ReferencedThreadTurn {
  userText: string | null;
  assistantText: string | null;
}

export function referencedThreadTurns(turns: Turn[]): ReferencedThreadTurn[] {
  return [...turns]
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    .map((turn) => ({
      userText: firstUserMessage(turn.items),
      assistantText: lastAssistantMessage(turn.items),
    }))
    .filter((turn) => turn.userText !== null || turn.assistantText !== null);
}

export function referencedThreadPrompt(thread: Thread, turns: ReferencedThreadTurn[], userRequest: string): string {
  const title = getThreadTitle(thread);
  const heading = [
    "[Codex Panel referenced thread]",
    `Title: ${title}`,
    `Thread ID: ${thread.id}`,
    `Included turns: ${String(turns.length)}/${String(REFERENCED_THREAD_TURN_LIMIT)}`,
    "Included history: user input and final Codex responses only.",
  ];

  return [
    ...heading,
    "",
    "Reference conversation:",
    ...turns.flatMap((turn, index) => {
      const lines = [`Turn ${String(index + 1)}:`];
      if (turn.userText) lines.push(`User:\n${turn.userText}`);
      if (turn.assistantText) lines.push(`Codex:\n${turn.assistantText}`);
      return ["", ...lines];
    }),
    "",
    "[/Codex Panel referenced thread]",
    "",
    "Current user request:",
    userRequest,
  ].join("\n");
}

export function referencedThreadStatus(thread: Thread, count: number): string {
  return `Referencing ${shortThreadId(thread.id)} (${String(count)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`;
}

export function referencedThreadDisplay(thread: Thread, count: number): ReferencedThreadDisplay {
  return {
    threadId: thread.id,
    title: getThreadTitle(thread),
    includedTurns: count,
    turnLimit: REFERENCED_THREAD_TURN_LIMIT,
  };
}

export function referencedThreadDisplayFromPrompt(text: string): { text: string; reference: ReferencedThreadDisplay } | null {
  const headerStart = text.indexOf("[Codex Panel referenced thread]");
  const headerEnd = text.indexOf("[/Codex Panel referenced thread]");
  const requestMarker = "\nCurrent user request:\n";
  const requestStart = text.indexOf(requestMarker);
  if (headerStart !== 0 || headerEnd === -1 || requestStart === -1 || requestStart < headerEnd) return null;

  const header = text.slice(headerStart, headerEnd);
  const title = lineValue(header, "Title") ?? "Referenced thread";
  const threadId = lineValue(header, "Thread ID") ?? "";
  const included = lineValue(header, "Included turns") ?? "";
  const turnsMatch = /^(\d+)\/(\d+)$/.exec(included);
  const includedTurns = turnsMatch ? Number.parseInt(turnsMatch[1], 10) : REFERENCED_THREAD_TURN_LIMIT;
  const turnLimit = turnsMatch ? Number.parseInt(turnsMatch[2], 10) : REFERENCED_THREAD_TURN_LIMIT;
  const visibleText = text.slice(requestStart + requestMarker.length).trim();
  if (!visibleText || !threadId) return null;
  return {
    text: visibleText,
    reference: {
      threadId,
      title,
      includedTurns,
      turnLimit,
    },
  };
}

function lineValue(text: string, key: string): string | null {
  const prefix = `${key}:`;
  const line = text
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
  return line && line.length > 0 ? line : null;
}

function firstUserMessage(items: ThreadItem[]): string | null {
  for (const item of items) {
    if (item.type !== "userMessage") continue;
    const text = inputToText(item.content).trim();
    if (text) return text;
  }
  return null;
}

function lastAssistantMessage(items: ThreadItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type !== "agentMessage" && item.type !== "plan") continue;
    const text = item.text.trim();
    if (text) return text;
  }
  return null;
}
