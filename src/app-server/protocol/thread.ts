import type { Thread, ThreadProvenance } from "../../domain/threads/model";

export interface ThreadRecord {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt?: number | null;
  [key: string]: unknown;
}

export function threadFromThreadRecord(thread: ThreadRecord, options: { archived?: boolean } = {}): Thread {
  const hasRecencyAt = Object.hasOwn(thread, "recencyAt");
  const recencyAt = hasRecencyAt ? thread.recencyAt : undefined;
  return {
    id: thread.id,
    preview: normalizeString(thread.preview),
    name: thread.name === null ? null : normalizeString(thread.name),
    archived: options.archived ?? false,
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
    subagentKind: subagentKind(subagent, threadSource),
    parentThreadId: stringOrNull(thread["parentThreadId"]) ?? stringOrNull(spawn?.["parent_thread_id"]),
    sessionId: stringOrNull(thread["sessionId"]),
    depth: finiteNumberOrNull(spawn?.["depth"]),
    agentNickname: stringOrNull(thread["agentNickname"]) ?? stringOrNull(spawn?.["agent_nickname"]),
    agentRole: stringOrNull(thread["agentRole"]) ?? stringOrNull(spawn?.["agent_role"]),
  };
}

function subagentKind(value: unknown, threadSource: string | null): Extract<ThreadProvenance, { kind: "subagent" }>["subagentKind"] {
  if (value === "review" || value === "compact" || value === "memory_consolidation") {
    return value === "memory_consolidation" ? "memory-consolidation" : value;
  }
  if (recordOrNull(value)?.["thread_spawn"] || threadSource === "subAgentThreadSpawn") return "thread-spawn";
  if (threadSource === "subAgentReview") return "review";
  if (threadSource === "subAgentCompact") return "compact";
  return "other";
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function threadsFromThreadRecords(threads: readonly ThreadRecord[], options: { archived?: boolean } = {}): Thread[] {
  return threads.map((thread) => threadFromThreadRecord(thread, options));
}

function normalizeString(value: string): string {
  return typeof value === "string" ? value : "";
}

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
