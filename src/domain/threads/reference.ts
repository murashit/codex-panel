import type { Thread } from "../../generated/app-server/v2/Thread";
import type { Turn } from "../../generated/app-server/v2/Turn";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import { shortThreadId } from "../../utils";
import { getThreadTitle } from "./model";
import { chronologicalTurnConversationSummaries } from "./transcript";

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

export interface ReferencedThreadInput {
  input: UserInput[];
  referencedThread: ReferencedThreadDisplay;
  status: string;
}

export function referencedThreadTurns(turns: Turn[]): ReferencedThreadTurn[] {
  return chronologicalTurnConversationSummaries(turns);
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
    "Reference thread history:",
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

export function referencedThreadInput(
  thread: Thread,
  turns: readonly ReferencedThreadTurn[],
  userRequest: string,
  messageInput: UserInput[],
): ReferencedThreadInput {
  const prompt = referencedThreadPrompt(thread, [...turns], userRequest);
  return {
    input: [{ type: "text", text: prompt, text_elements: [] }, ...messageInput.filter((item) => item.type !== "text")],
    referencedThread: referencedThreadDisplay(thread, turns.length),
    status: referencedThreadStatus(thread, turns.length),
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
  const includedTurns = turnsMatch?.[1] ? Number.parseInt(turnsMatch[1], 10) : REFERENCED_THREAD_TURN_LIMIT;
  const turnLimit = turnsMatch?.[2] ? Number.parseInt(turnsMatch[2], 10) : REFERENCED_THREAD_TURN_LIMIT;
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
