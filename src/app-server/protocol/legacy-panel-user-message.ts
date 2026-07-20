import type { VaultFileReference } from "../../domain/chat/input";
import type { ReferencedThreadMetadata } from "../../domain/threads/reference";

/*
 * Compatibility boundary for user messages persisted by old Codex Panel
 * versions. New request construction must not depend on this module. Once old
 * thread history no longer needs recovery, delete this file and its explicit
 * fallbacks in turn.ts.
 */

function legacyPanelReferencedThreadFromPrompt(text: string): { text: string; reference: ReferencedThreadMetadata } | null {
  const envelope = referencedThreadEnvelopeFromPrompt(text);
  return envelope ? { text: envelope.visibleText, reference: envelope.reference } : null;
}

interface LegacyPanelUserMessageContentItem {
  type: string;
  name?: string;
  path?: string;
}

interface LegacyPanelUserMessageInput {
  content: readonly LegacyPanelUserMessageContentItem[];
  visibleText: string;
}

export interface LegacyPanelUserMessageProjection {
  text: string;
  referencedThread: ReferencedThreadMetadata | null;
  fileReferences: VaultFileReference[];
  mentionTextByContentIndex: ReadonlyMap<number, string>;
}

export function legacyPanelUserMessageProjection(input: LegacyPanelUserMessageInput): LegacyPanelUserMessageProjection {
  const referencedThread = legacyPanelReferencedThreadFromPrompt(input.visibleText);
  const fileReferences: VaultFileReference[] = [];
  const mentionTextByContentIndex = new Map<number, string>();
  for (const [index, item] of input.content.entries()) {
    if (!isMention(item)) continue;
    const reference = legacyPanelFileReference(item);
    if (reference) fileReferences.push(reference);
    if (!input.visibleText) {
      mentionTextByContentIndex.set(index, reference ? `[file] ${reference.path}` : `[@${item.name}] ${item.path}`);
    }
  }
  return {
    text: referencedThread?.text ?? input.visibleText,
    referencedThread: referencedThread?.reference ?? null,
    fileReferences,
    mentionTextByContentIndex,
  };
}

function isMention(
  input: LegacyPanelUserMessageInput["content"][number],
): input is LegacyPanelUserMessageContentItem & { type: "mention"; name: string; path: string } {
  return input.type === "mention" && typeof input.name === "string" && typeof input.path === "string";
}

function legacyPanelFileReference(input: { name: string; path: string }): VaultFileReference | null {
  if (!input.path || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(input.path)) return null;
  return { name: input.name, path: input.path };
}

const REFERENCED_THREAD_ENVELOPE_START = "[Codex Panel referenced thread v1]";
const REFERENCED_THREAD_ENVELOPE_END = "[/Codex Panel referenced thread]";

interface ReferencedThreadEnvelope {
  version: 1;
  reference: ReferencedThreadMetadata;
  visibleText: string;
}

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
