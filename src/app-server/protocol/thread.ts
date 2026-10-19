import type { Thread, ThreadProvenance } from "../../domain/threads/model";
import type { Thread as GeneratedThread } from "../../generated/app-server/v2/Thread";

type RequiredThreadRecordFields = "id" | "preview" | "name" | "createdAt" | "updatedAt";
// Codex 0.157: codex_state::PINNED_THREAD_SECTION_ID. The section name is presentation data.
export const BUILT_IN_PINNED_THREAD_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318";

export type ThreadRecord = Pick<GeneratedThread, RequiredThreadRecordFields> &
  Partial<Omit<GeneratedThread, RequiredThreadRecordFields | "historyMode" | "source" | "status" | "turns">> & {
    /** Kept unknown so archive export routes absent or newer modes through its legacy-history fallback. */
    historyMode?: unknown;
    /** Kept unknown at the protocol edge so newer SessionSource variants do not break thread lists. */
    source?: unknown;
    status?: unknown;
    turns?: readonly GeneratedThread["turns"][number][];
  };

export function threadFromThreadRecord(thread: ThreadRecord, options: { archived?: boolean } = {}): Thread {
  const hasRecencyAt = Object.hasOwn(thread, "recencyAt");
  const recencyAt = hasRecencyAt ? thread.recencyAt : undefined;
  return {
    id: thread.id,
    preview: normalizeString(thread.preview),
    name: thread.name === null ? null : normalizeString(thread.name),
    archived: options.archived ?? false,
    ephemeral: thread.ephemeral === true,
    ...(thread.section?.id === BUILT_IN_PINNED_THREAD_SECTION_ID ? { isPinned: true } : {}),
    createdAt: finiteTimestamp(thread.createdAt),
    updatedAt: finiteTimestamp(thread.updatedAt),
    provenance: threadProvenance(thread),
    ...(hasRecencyAt ? { recencyAt: typeof recencyAt === "number" && Number.isFinite(recencyAt) ? recencyAt : null } : {}),
  };
}

function threadProvenance(thread: ThreadRecord): ThreadProvenance {
  const source = recordOrNull(thread["source"]);
  const subagent = source?.["subAgent"];
  const threadSource = stringOrNull(thread["threadSource"]);
  if (subagent === undefined && stringOrNull(thread["parentThreadId"]) === null && !threadSource?.startsWith("subAgent")) {
    return { kind: "interactive" };
  }

  const spawn = recordOrNull(recordOrNull(subagent)?.["thread_spawn"]);
  return {
    kind: "subagent",
    parentThreadId: stringOrNull(thread["parentThreadId"]) ?? stringOrNull(spawn?.["parent_thread_id"]),
  };
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function threadsFromThreadRecords(threads: readonly ThreadRecord[], options: { archived?: boolean } = {}): Thread[] {
  return threads.flatMap((thread) => {
    if (thread.ephemeral === true || threadProvenance(thread).kind === "subagent") return [];
    return [threadFromThreadRecord(thread, options)];
  });
}

function normalizeString(value: string): string {
  return typeof value === "string" ? value : "";
}

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
