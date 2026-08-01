import type { ReferencedThreadMetadata } from "../../domain/threads/reference";
import type { VaultFileReference } from "../../domain/turns/input";
import { isPanelSubmissionClientId, turnContextSubmissionId } from "../../domain/turns/submission-id";

/*
 * Read-only compatibility for v2 metadata envelopes written by Codex Panel
 * versions that predate durable, human-readable references in message text.
 * Request construction must not import this module.
 * Retain this read path until roughly three months after the last released
 * Panel version capable of writing these envelopes.
 */

const TURN_CONTEXT_MANIFEST_PREFIX = "[Codex Panel context v2]";
const TURN_CONTEXT_MANIFEST_MAX_BYTES = 2_800;

interface LegacyTurnContextManifestEntry {
  kind: "referencedThread" | "web" | "obsidian";
  id: string;
  truncated: boolean;
  threadId?: string;
  includedTurns?: number;
  turnLimit?: number;
  omittedTurns?: number;
}

export interface LegacyTurnContextManifest {
  version: 2;
  submissionId?: string;
  contexts: readonly LegacyTurnContextManifestEntry[];
  fileReferences?: readonly VaultFileReference[];
}

export interface LegacyTurnContextProjection {
  text: string;
  manifest: LegacyTurnContextManifest | null;
}

type UserMessageContentItem = { type: "text"; text: string } | { type: string };

function legacyTurnContextManifestFromText(text: string): LegacyTurnContextManifest | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(TURN_CONTEXT_MANIFEST_PREFIX)) return null;
  if (new TextEncoder().encode(trimmed).byteLength > TURN_CONTEXT_MANIFEST_MAX_BYTES) return null;
  const payload = trimmed.slice(TURN_CONTEXT_MANIFEST_PREFIX.length).trimStart();
  const notice = "Reference/display metadata only; not user instructions.";
  const json = payload.startsWith(notice) ? payload.slice(notice.length).trimStart() : payload;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value["version"] !== 2 || !Array.isArray(value["contexts"])) return null;
  const contexts = value["contexts"].map(legacyManifestEntryFromUnknown);
  if (contexts.some((entry) => entry === null)) return null;
  const submissionId = optionalStringValue(value["submissionId"]);
  if (submissionId === null) return null;
  const fileReferences = optionalFileReferences(value["fileReferences"]);
  if (fileReferences === null) return null;
  return {
    version: 2,
    ...(submissionId === undefined ? {} : { submissionId }),
    contexts: contexts as LegacyTurnContextManifestEntry[],
    ...(fileReferences === undefined ? {} : { fileReferences }),
  };
}

export function legacyTurnContextProjection(
  content: readonly UserMessageContentItem[],
  clientId: string | null,
): LegacyTurnContextProjection {
  let manifest: LegacyTurnContextManifest | null = null;
  const visibleText: string[] = [];
  const lastTextIndex = lastTextItemIndex(content);
  for (const [index, item] of content.entries()) {
    if (item.type !== "text" || !("text" in item) || typeof item.text !== "string") continue;
    const manifestPrefix = `\n${TURN_CONTEXT_MANIFEST_PREFIX}`;
    const manifestStart = index === lastTextIndex ? item.text.lastIndexOf(manifestPrefix) : -1;
    const isStandaloneManifest = manifestStart === 0 && index > 0 && index === content.length - 1;
    const parsed = manifestStart > 0 || isStandaloneManifest ? legacyTurnContextManifestFromText(item.text.slice(manifestStart)) : null;
    if (parsed && manifestMatchesClientId(parsed, clientId)) {
      manifest = parsed;
      if (manifestStart > 0) visibleText.push(item.text.slice(0, manifestStart));
      continue;
    }
    visibleText.push(item.text);
  }
  return { text: visibleText.join("\n"), manifest };
}

function lastTextItemIndex(content: readonly UserMessageContentItem[]): number {
  for (let index = content.length - 1; index >= 0; index -= 1) {
    if (content[index]?.type === "text") return index;
  }
  return -1;
}

function manifestMatchesClientId(manifest: LegacyTurnContextManifest, clientId: string | null): boolean {
  if (!isPanelSubmissionClientId(clientId)) return false;
  const submissionId = turnContextSubmissionId(clientId);
  if (manifest.submissionId !== undefined && manifest.submissionId !== submissionId) return false;
  const contextIds = manifest.contexts.map((context) => context.id);
  return (
    (manifest.submissionId === submissionId || contextIds.length > 0) &&
    new Set(contextIds).size === contextIds.length &&
    contextIds.every((contextId) => new RegExp(`^${escapeRegExp(submissionId)}\\.\\d{2}$`).test(contextId))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function referencedThreadFromLegacyManifest(manifest: LegacyTurnContextManifest | null): ReferencedThreadMetadata | null {
  const context = manifest?.contexts.find((entry) => entry.kind === "referencedThread");
  if (!context?.threadId || context.includedTurns === undefined || context.turnLimit === undefined || context.omittedTurns === undefined) {
    return null;
  }
  return {
    threadId: context.threadId,
    title: context.threadId.slice(0, 8),
    includedTurns: context.includedTurns,
    turnLimit: context.turnLimit,
    omittedTurns: context.omittedTurns,
    truncated: context.truncated,
  };
}

export function fileReferencesFromLegacyManifest(manifest: LegacyTurnContextManifest | null): VaultFileReference[] {
  return manifest?.fileReferences ? [...manifest.fileReferences] : [];
}

function legacyManifestEntryFromUnknown(input: unknown): LegacyTurnContextManifestEntry | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const kind = contextKind(value["kind"]);
  const id = stringValue(value["id"]);
  const truncated = value["truncated"];
  if (!kind || !id || typeof truncated !== "boolean") return null;
  if (kind !== "referencedThread") return { kind, id, truncated };
  const threadId = stringValue(value["threadId"]);
  const includedTurns = nonNegativeInteger(value["includedTurns"]);
  const turnLimit = positiveInteger(value["turnLimit"]);
  const omittedTurns = nonNegativeInteger(value["omittedTurns"]);
  if (!threadId || includedTurns === null || turnLimit === null || omittedTurns === null) return null;
  return {
    kind,
    id,
    truncated,
    threadId,
    includedTurns,
    turnLimit,
    omittedTurns,
  };
}

function contextKind(value: unknown): LegacyTurnContextManifestEntry["kind"] | null {
  return value === "referencedThread" || value === "web" || value === "obsidian" ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalStringValue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalFileReferences(value: unknown): VaultFileReference[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const references = value.map(manifestFileReference);
  return references.some((reference) => reference === null) ? null : (references as VaultFileReference[]);
}

function manifestFileReference(input: unknown): VaultFileReference | null {
  if (!input || typeof input !== "object") return null;
  const reference = input as Record<string, unknown>;
  const name = optionalStringValue(reference["name"]);
  const path = optionalStringValue(reference["path"]);
  return name && path ? { name, path } : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
