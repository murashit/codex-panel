import { truncateUtf8, utf8ByteLength } from "../chat/context-budget";
import type { Thread } from "./model";
import { threadDisplayTitle } from "./title";
import type { TurnTranscriptSummary } from "./transcript";

export const REFERENCED_THREAD_TURN_LIMIT = 20;

export interface ReferencedThreadMetadata {
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
  omittedTurns?: number;
  truncated?: boolean;
}

export interface ReferencedThreadContextBundle {
  value: string;
  referencedThread: ReferencedThreadMetadata;
}

const REFERENCED_THREAD_CONTEXT_MAX_BYTES = 18_000;

function referencedThreadMetadata(thread: Thread, count: number): ReferencedThreadMetadata {
  return {
    threadId: thread.id,
    title: threadDisplayTitle(thread),
    includedTurns: count,
    turnLimit: REFERENCED_THREAD_TURN_LIMIT,
  };
}

export function referencedThreadContextBundle(thread: Thread, turns: readonly TurnTranscriptSummary[]): ReferencedThreadContextBundle {
  const rendered = turns.map((turn, index) => renderedReferenceTurn(turn, index + 1));
  const included: string[] = [];
  let bytes = 0;
  let truncatedTurn = false;
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    const value = rendered[index];
    if (value === undefined) continue;
    const nextBytes = utf8ByteLength(value);
    if (bytes + nextBytes > REFERENCED_THREAD_CONTEXT_MAX_BYTES) {
      if (included.length === 0) {
        const turn = turns[index];
        if (turn) included.unshift(truncatedReferenceTurn(turn, index + 1, REFERENCED_THREAD_CONTEXT_MAX_BYTES));
        truncatedTurn = true;
      }
      break;
    }
    included.unshift(value);
    bytes += nextBytes;
  }
  const omittedTurns = turns.length - included.length;
  const reference = {
    ...referencedThreadMetadata(thread, included.length),
    omittedTurns,
    truncated: omittedTurns > 0 || truncatedTurn,
  };
  return {
    value: [
      "Referenced thread context for the current user input:",
      `Thread: ${thread.id}`,
      `Included turns: ${String(reference.includedTurns)}`,
      `Omitted turns: ${String(omittedTurns)}`,
      "",
      ...included,
    ].join("\n"),
    referencedThread: reference,
  };
}

function renderedReferenceTurn(turn: TurnTranscriptSummary, index: number): string {
  const lines = [`Turn ${String(index)}:`];
  if (turn.userText) lines.push(`User:\n${turn.userText}`);
  if (turn.assistantText) lines.push(`Codex:\n${turn.assistantText}`);
  return `${lines.join("\n")}\n\n`;
}

function truncatedReferenceTurn(turn: TurnTranscriptSummary, index: number, maxBytes: number): string {
  const user = turn.userText ?? "";
  const assistant = turn.assistantText ?? "";
  const prefix = `Turn ${String(index)}:\n`;
  const userLabel = user ? "User:\n" : "";
  const assistantLabel = assistant ? "Codex:\n" : "";
  const separator = user && assistant ? "\n" : "";
  const suffix = "\n[Turn fields truncated]\n\n";
  const fixedBytes = utf8ByteLength(`${prefix}${userLabel}${separator}${assistantLabel}${suffix}`);
  const available = Math.max(maxBytes - fixedBytes, 0);
  const userBytes = utf8ByteLength(user);
  const assistantBytes = utf8ByteLength(assistant);
  let assistantBudget = assistant ? Math.min(assistantBytes, Math.floor(available / 2)) : 0;
  let userBudget = user ? Math.min(userBytes, available - assistantBudget) : 0;
  const remaining = available - userBudget - assistantBudget;
  assistantBudget += Math.min(Math.max(assistantBytes - assistantBudget, 0), remaining);
  userBudget += Math.min(Math.max(userBytes - userBudget, 0), available - userBudget - assistantBudget);
  return [
    prefix,
    user ? `${userLabel}${truncateUtf8(user, userBudget)}` : "",
    separator,
    assistant ? `${assistantLabel}${truncateUtf8(assistant, assistantBudget)}` : "",
    suffix,
  ].join("");
}
