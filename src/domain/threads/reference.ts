import { truncateUtf8, utf8ByteLength } from "../turns/context-budget";
import type { Thread } from "./model";

export const REFERENCED_THREAD_TURN_LIMIT = 20;

export interface ReferencedThreadMetadata {
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
  omittedTurns?: number;
  truncated?: boolean;
}

const REFERENCED_THREAD_CONTEXT_MAX_BYTES = 18_000;
const REFERENCED_TURN_MESSAGE_LIMIT = 128;

interface ReferencedThreadMessage {
  kind: "user" | "assistant" | "plan";
  text: string;
}

interface LabeledReferencedThreadMessage {
  label: string;
  text: string;
}

export interface ReferencedThreadTurn {
  messages: readonly ReferencedThreadMessage[];
}

export interface ReferencedThreadTranscriptPage {
  turns: readonly ReferencedThreadTurn[];
  earlierTurnsAvailable: boolean;
}

export function referencedThreadContext(thread: Thread, transcript: ReferencedThreadTranscriptPage): string {
  const { turns } = transcript;
  const rendered = turns.map((turn, index) => renderedReferenceTurn(turn, index + 1));
  const included: string[] = [];
  let bytes = 0;
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    const value = rendered[index];
    if (value === undefined) continue;
    const nextBytes = utf8ByteLength(value);
    if (bytes + nextBytes > REFERENCED_THREAD_CONTEXT_MAX_BYTES) {
      if (included.length === 0) {
        const turn = turns[index];
        if (turn) included.unshift(truncatedReferenceTurn(turn, index + 1, REFERENCED_THREAD_CONTEXT_MAX_BYTES));
      }
      break;
    }
    included.unshift(value);
    bytes += nextBytes;
  }
  const omittedTurns = turns.length - included.length;
  return [
    "Referenced thread context for the current user input:",
    `Thread: ${thread.id}`,
    `Included recent turns: ${String(included.length)}`,
    `Omitted fetched turns due to size: ${String(omittedTurns)}`,
    `Earlier turns not fetched: ${transcript.earlierTurnsAvailable ? "yes" : "no"}`,
    "",
    ...included,
  ].join("\n");
}

function renderedReferenceTurn(turn: ReferencedThreadTurn, index: number): string {
  const lines = [`Included turn ${String(index)}:`];
  for (const message of labeledReferenceMessages(turn)) lines.push(`${message.label}:\n${message.text}`);
  return `${lines.join("\n")}\n\n`;
}

function labeledReferenceMessages(turn: ReferencedThreadTurn): LabeledReferencedThreadMessage[] {
  const messages: LabeledReferencedThreadMessage[] = [];
  let userMessageIndex = 0;
  for (const message of turn.messages) {
    if (message.kind === "user") userMessageIndex += 1;
    messages.push({ label: referenceMessageLabel(message, userMessageIndex), text: message.text });
  }
  return messages;
}

function referenceMessageLabel(message: ReferencedThreadMessage, userMessageIndex: number): string {
  if (message.kind === "user") return userMessageIndex === 1 ? "User" : "User follow-up";
  return message.kind === "plan" ? "Codex plan" : "Codex";
}

function truncatedReferenceTurn(turn: ReferencedThreadTurn, index: number, maxBytes: number): string {
  const prefix = `Included turn ${String(index)}:\n`;
  const suffix = "[Turn dialogue truncated]\n\n";
  const labeled = labeledReferenceMessages(turn);
  const bounded = boundedReferenceMessages(labeled);
  const omitted = labeled.length - bounded.length;
  const omissionNotice = omitted > 0 ? `[${String(omitted)} dialogue messages omitted from the middle]\n` : "";
  const fixed = [prefix, omissionNotice, suffix, ...bounded.map((message) => `${message.label}:\n\n`)].join("");
  const textBudget = Math.max(maxBytes - utf8ByteLength(fixed), 0);
  const perMessageBudget = bounded.length > 0 ? Math.floor(textBudget / bounded.length) : 0;
  const messages = bounded.map((message) => `${message.label}:\n${truncateUtf8(message.text, perMessageBudget)}\n`);
  return `${prefix}${messages[0] ?? ""}${omissionNotice}${messages.slice(1).join("")}${suffix}`;
}

function boundedReferenceMessages(messages: readonly LabeledReferencedThreadMessage[]): LabeledReferencedThreadMessage[] {
  if (messages.length <= REFERENCED_TURN_MESSAGE_LIMIT) return [...messages];
  const first = messages[0];
  return first ? [first, ...messages.slice(-(REFERENCED_TURN_MESSAGE_LIMIT - 1))] : [];
}
