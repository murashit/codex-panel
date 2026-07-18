import type { ReferencedThreadMetadata } from "../threads/reference";

const TURN_CONTEXT_MANIFEST_PREFIX = "[Codex Panel context v2]";

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
  | { kind: "obsidian" };

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
}

export interface TurnContextManifest {
  version: 2;
  contexts: readonly TurnContextManifestEntry[];
}

export interface UserMessageContextProjection {
  text: string;
  manifest: TurnContextManifest | null;
}

export function turnContextManifestText(contexts: readonly TurnContextManifestEntry[]): string {
  return `${TURN_CONTEXT_MANIFEST_PREFIX}${JSON.stringify({ version: 2, contexts } satisfies TurnContextManifest)}`;
}

export function turnContextManifestFromText(text: string): TurnContextManifest | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(TURN_CONTEXT_MANIFEST_PREFIX)) return null;
  const json = trimmed.slice(TURN_CONTEXT_MANIFEST_PREFIX.length);
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
  return { version: 2, contexts: contexts as TurnContextManifestEntry[] };
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
  if (!clientId || !/^local-(?:user|steer)-\d+-[A-Za-z0-9_-]+-[a-z0-9]+-[a-z0-9]+$/.test(clientId)) return false;
  const submissionId = turnContextSubmissionId(clientId);
  return manifest.contexts.every((context, index) => context.id === `${submissionId}.${String(index).padStart(2, "0")}`);
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

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
