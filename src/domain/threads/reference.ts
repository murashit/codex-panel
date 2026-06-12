import { shortThreadId } from "../../utils";
import { getThreadTitle, type Thread } from "./model";
import type { ThreadConversationSummary } from "./transcript";

export const REFERENCED_THREAD_TURN_LIMIT = 20;

export interface ReferencedThreadDisplay {
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
}

interface ReferencedThreadEnvelope {
  version: 1;
  reference: ReferencedThreadDisplay;
  visibleText: string;
}

export interface ReferencedThreadPromptBundle {
  prompt: string;
  referencedThread: ReferencedThreadDisplay;
  status: string;
}

export function referencedThreadPrompt(thread: Thread, turns: readonly ThreadConversationSummary[], userRequest: string): string {
  const reference = referencedThreadDisplay(thread, turns.length);
  const envelope = referencedThreadEnvelope(reference, userRequest);

  return [
    REFERENCED_THREAD_ENVELOPE_START,
    JSON.stringify(envelopeMetadata(envelope)),
    "",
    "Reference thread history:",
    ...turns.flatMap((turn, index) => {
      const lines = [`Turn ${String(index + 1)}:`];
      if (turn.userText) lines.push(`User:\n${turn.userText}`);
      if (turn.assistantText) lines.push(`Codex:\n${turn.assistantText}`);
      return ["", ...lines];
    }),
    "",
    REFERENCED_THREAD_ENVELOPE_END,
    "",
    "Current user request:",
    envelope.visibleText,
  ].join("\n");
}

function referencedThreadStatus(thread: Thread, count: number): string {
  return `Referencing ${shortThreadId(thread.id)} (${String(count)}/${String(REFERENCED_THREAD_TURN_LIMIT)} turns).`;
}

function referencedThreadDisplay(thread: Thread, count: number): ReferencedThreadDisplay {
  return {
    threadId: thread.id,
    title: getThreadTitle(thread),
    includedTurns: count,
    turnLimit: REFERENCED_THREAD_TURN_LIMIT,
  };
}

export function referencedThreadPromptBundle(
  thread: Thread,
  turns: readonly ThreadConversationSummary[],
  userRequest: string,
): ReferencedThreadPromptBundle {
  const prompt = referencedThreadPrompt(thread, [...turns], userRequest);
  return {
    prompt,
    referencedThread: referencedThreadDisplay(thread, turns.length),
    status: referencedThreadStatus(thread, turns.length),
  };
}

export function referencedThreadDisplayFromPrompt(text: string): { text: string; reference: ReferencedThreadDisplay } | null {
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

function referencedThreadEnvelope(reference: ReferencedThreadDisplay, visibleText: string): ReferencedThreadEnvelope {
  return {
    version: 1,
    reference,
    visibleText,
  };
}

function envelopeMetadata(envelope: ReferencedThreadEnvelope): ReferencedThreadEnvelopeMetadata {
  return {
    version: envelope.version,
    threadId: envelope.reference.threadId,
    title: envelope.reference.title,
    includedTurns: envelope.reference.includedTurns,
    turnLimit: envelope.reference.turnLimit,
  };
}

function referencedThreadEnvelopeFromPrompt(text: string): ReferencedThreadEnvelope | null {
  const headerStart = text.indexOf(REFERENCED_THREAD_ENVELOPE_START);
  const headerEnd = text.indexOf(REFERENCED_THREAD_ENVELOPE_END);
  const requestMarker = "\nCurrent user request:\n";
  const requestStart = text.indexOf(requestMarker);
  if (headerStart !== 0 || headerEnd === -1 || requestStart === -1 || requestStart < headerEnd) return null;

  const metadataText = firstNonEmptyLine(text.slice(REFERENCED_THREAD_ENVELOPE_START.length, headerEnd));
  const metadata = referencedThreadEnvelopeMetadataFromJson(metadataText);
  const visibleText = text.slice(requestStart + requestMarker.length).trim();
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
