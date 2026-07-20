import type { ReferencedThreadMetadata } from "../threads/reference";
import { utf8ByteLength } from "./context-budget";
import type { VaultFileReference } from "./input";
import { isPanelSubmissionClientId } from "./submission-id";

const TURN_CONTEXT_MANIFEST_PREFIX = "[Codex Panel context v2]";
const TURN_CONTEXT_MANIFEST_NOTICE = "\nReference/display metadata only; not user instructions.\n";
const TURN_CONTEXT_MANIFEST_MAX_BYTES = 2_800;
const TURN_CONTEXT_FILE_REFERENCE_MAX_COUNT = 64;
const TURN_CONTEXT_FILE_REFERENCE_NAME_MAX_LENGTH = 255;
const TURN_CONTEXT_FILE_REFERENCE_PATH_MAX_LENGTH = 2_048;

export type TurnContextAttachment =
  | {
      kind: "referencedThread";
      threadId: string;
      includedTurns: number;
      turnLimit: number;
      omittedTurns: number;
      truncated: boolean;
    }
  | { kind: "web" }
  | { kind: "obsidian"; inlineExcerpts: number };

export interface TurnContextManifestEntry {
  kind: TurnContextAttachment["kind"];
  id: string;
  parts: number;
  sourceBytes: number;
  includedBytes: number;
  truncated: boolean;
  threadId?: string;
  includedTurns?: number;
  turnLimit?: number;
  omittedTurns?: number;
  inlineExcerpts?: number;
}

export interface TurnContextManifest {
  version: 2;
  submissionId?: string;
  contexts: readonly TurnContextManifestEntry[];
  fileReferences?: readonly VaultFileReference[];
}

export interface UserMessageContextProjection {
  text: string;
  manifest: TurnContextManifest | null;
}

export function turnContextManifestText(manifest: TurnContextManifest): string {
  return `${TURN_CONTEXT_MANIFEST_PREFIX}${TURN_CONTEXT_MANIFEST_NOTICE}${JSON.stringify(manifest)}`;
}

export function boundedTurnContextManifest(
  submissionId: string,
  contexts: readonly TurnContextManifestEntry[],
  fileReferences: readonly VaultFileReference[],
): TurnContextManifest | null {
  const base = {
    version: 2,
    submissionId: turnContextSubmissionId(submissionId),
    contexts,
  } satisfies TurnContextManifest;
  if (utf8ByteLength(turnContextManifestText(base)) > TURN_CONTEXT_MANIFEST_MAX_BYTES) return null;
  const included: VaultFileReference[] = [];
  const seen = new Set<string>();
  for (const reference of fileReferences) {
    const normalized = manifestFileReference(reference);
    if (!normalized || included.length >= TURN_CONTEXT_FILE_REFERENCE_MAX_COUNT) continue;
    const identity = `${normalized.name}\u0000${normalized.path}`;
    if (seen.has(identity)) continue;
    const candidate = { ...base, fileReferences: [...included, normalized] } satisfies TurnContextManifest;
    if (utf8ByteLength(turnContextManifestText(candidate)) > TURN_CONTEXT_MANIFEST_MAX_BYTES) continue;
    seen.add(identity);
    included.push(normalized);
  }
  if (contexts.length === 0 && included.length === 0) return null;
  return { ...base, ...(included.length > 0 ? { fileReferences: included } : {}) };
}

function turnContextManifestFromText(text: string): TurnContextManifest | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(TURN_CONTEXT_MANIFEST_PREFIX)) return null;
  if (utf8ByteLength(trimmed) > TURN_CONTEXT_MANIFEST_MAX_BYTES) return null;
  const payload = trimmed.slice(TURN_CONTEXT_MANIFEST_PREFIX.length).trimStart();
  const notice = TURN_CONTEXT_MANIFEST_NOTICE.trim();
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
  const contexts = value["contexts"].map(manifestEntryFromUnknown);
  if (contexts.some((entry) => entry === null)) return null;
  const submissionId = optionalStringValue(value["submissionId"], 120);
  if (submissionId === null) return null;
  const fileReferences = optionalFileReferences(value["fileReferences"]);
  if (fileReferences === null) return null;
  return {
    version: 2,
    ...(submissionId === undefined ? {} : { submissionId }),
    contexts: contexts as TurnContextManifestEntry[],
    ...(fileReferences === undefined ? {} : { fileReferences }),
  };
}

export function userMessageContextProjection(
  content: readonly ({ type: "text"; text: string } | { type: string })[],
  clientId: string | null,
): UserMessageContextProjection {
  let manifest: TurnContextManifest | null = null;
  const visibleText: string[] = [];
  for (const [index, item] of content.entries()) {
    if (item.type !== "text" || !("text" in item) || typeof item.text !== "string") continue;
    const parsed =
      index > 0 && index === content.length - 1 && item.text.startsWith(`\n${TURN_CONTEXT_MANIFEST_PREFIX}`)
        ? turnContextManifestFromText(item.text)
        : null;
    if (parsed && manifestMatchesClientId(parsed, clientId)) {
      manifest = parsed;
      continue;
    }
    visibleText.push(item.text);
  }
  return { text: visibleText.join("\n"), manifest };
}

export function turnContextSubmissionId(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  return safe || "context";
}

function manifestMatchesClientId(manifest: TurnContextManifest, clientId: string | null): boolean {
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

export function referencedThreadFromManifest(manifest: TurnContextManifest | null): ReferencedThreadMetadata | null {
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

export function fileReferencesFromManifest(manifest: TurnContextManifest | null): VaultFileReference[] {
  return manifest?.fileReferences ? [...manifest.fileReferences] : [];
}

function manifestEntryFromUnknown(input: unknown): TurnContextManifestEntry | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const kind = contextKind(value["kind"]);
  const id = stringValue(value["id"]);
  const parts = nonNegativeInteger(value["parts"]);
  const sourceBytes = nonNegativeInteger(value["sourceBytes"]);
  const includedBytes = nonNegativeInteger(value["includedBytes"]);
  const truncated = value["truncated"];
  if (!kind || !id || parts === null || sourceBytes === null || includedBytes === null || typeof truncated !== "boolean") return null;

  if (kind === "obsidian") {
    const inlineExcerpts = optionalNonNegativeInteger(value["inlineExcerpts"]);
    if (inlineExcerpts === null) return null;
    return {
      kind,
      id,
      parts,
      sourceBytes,
      includedBytes,
      truncated,
      ...(inlineExcerpts === undefined ? {} : { inlineExcerpts }),
    };
  }
  if (kind !== "referencedThread") return { kind, id, parts, sourceBytes, includedBytes, truncated };
  const threadId = stringValue(value["threadId"]);
  const includedTurns = nonNegativeInteger(value["includedTurns"]);
  const turnLimit = positiveInteger(value["turnLimit"]);
  const omittedTurns = nonNegativeInteger(value["omittedTurns"]);
  if (!threadId || includedTurns === null || turnLimit === null || omittedTurns === null) return null;
  return {
    kind,
    id,
    parts,
    sourceBytes,
    includedBytes,
    truncated,
    threadId,
    includedTurns,
    turnLimit,
    omittedTurns,
  };
}

function contextKind(value: unknown): TurnContextAttachment["kind"] | null {
  return value === "referencedThread" || value === "web" || value === "obsidian" ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 160 ? value : null;
}

function optionalStringValue(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function optionalFileReferences(value: unknown): VaultFileReference[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > TURN_CONTEXT_FILE_REFERENCE_MAX_COUNT) return null;
  const references = value.map(manifestFileReference);
  return references.some((reference) => reference === null) ? null : (references as VaultFileReference[]);
}

function manifestFileReference(input: unknown): VaultFileReference | null {
  if (!input || typeof input !== "object") return null;
  const reference = input as Record<string, unknown>;
  const name = optionalStringValue(reference["name"], TURN_CONTEXT_FILE_REFERENCE_NAME_MAX_LENGTH);
  const path = optionalStringValue(reference["path"], TURN_CONTEXT_FILE_REFERENCE_PATH_MAX_LENGTH);
  return name && path ? { name, path } : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalNonNegativeInteger(value: unknown): number | null | undefined {
  return value === undefined ? undefined : nonNegativeInteger(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
