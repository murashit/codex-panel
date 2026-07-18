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

interface ReferencedThreadEnvelope {
  version: 1;
  reference: ReferencedThreadMetadata;
  visibleText: string;
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

export function referencedThreadMetadataFromPrompt(text: string): { text: string; reference: ReferencedThreadMetadata } | null {
  const envelope = referencedThreadEnvelopeFromPrompt(text);
  return envelope ? { text: envelope.visibleText, reference: envelope.reference } : null;
}

const REFERENCED_THREAD_ENVELOPE_START = "[Codex Panel referenced thread v1]";
const REFERENCED_THREAD_ENVELOPE_END = "[/Codex Panel referenced thread]";

interface ReferencedThreadEnvelopeMetadata {
  version: 1;
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
}

function referencedThreadEnvelopeFromPrompt(text: string): ReferencedThreadEnvelope | null {
  const headerStart = text.indexOf(REFERENCED_THREAD_ENVELOPE_START);
  const requestBoundary = `\n${REFERENCED_THREAD_ENVELOPE_END}\n\nCurrent user request:\n`;
  const boundaryStart = text.lastIndexOf(requestBoundary);
  if (headerStart !== 0 || boundaryStart === -1) return null;

  const metadataText = firstNonEmptyLine(text.slice(REFERENCED_THREAD_ENVELOPE_START.length, boundaryStart));
  const metadata = referencedThreadEnvelopeMetadataFromJson(metadataText);
  const visibleText = text.slice(boundaryStart + requestBoundary.length).trim();
  if (!metadata || !visibleText) return null;
  return {
    version: 1,
    visibleText,
    reference: {
      threadId: metadata.threadId,
      title: metadata.title,
      includedTurns: metadata.includedTurns,
      turnLimit: metadata.turnLimit,
    },
  };
}

function firstNonEmptyLine(text: string): string | null {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

function referencedThreadEnvelopeMetadataFromJson(text: string | null): ReferencedThreadEnvelopeMetadata | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value["version"] !== 1) return null;
  const threadId = stringValue(value["threadId"]);
  const title = stringValue(value["title"]);
  const includedTurns = finiteNonNegativeInteger(value["includedTurns"]);
  const turnLimit = finitePositiveInteger(value["turnLimit"]);
  if (!threadId || !title || includedTurns === null || turnLimit === null) return null;
  return {
    version: 1,
    threadId,
    title,
    includedTurns,
    turnLimit,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
