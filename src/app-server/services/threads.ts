import { normalizeReasoningEffort } from "../../domain/catalog/metadata";
import { type RuntimePermissionState, runtimePermissionStateOrDefault } from "../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../domain/runtime/policy";
import { parseServiceTier } from "../../domain/runtime/policy";
import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../domain/runtime/thread-settings";
import type { ThreadActivationSnapshot } from "../../domain/threads/activation";
import type { ArchiveThreadInput } from "../../domain/threads/archive-markdown";
import type { ThreadGoal, ThreadGoalUpdate } from "../../domain/threads/goal";
import type { Thread } from "../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT, type ReferencedThreadTranscriptPage } from "../../domain/threads/reference";
import type { TurnTranscriptSummary } from "../../domain/threads/transcript";
import type { ClientResponseByMethod } from "../connection/client";
import type { ClientRequestParams } from "../connection/rpc-messages";
import {
  BUILT_IN_PINNED_THREAD_SECTION_NAME,
  type ThreadRecord,
  threadFromThreadRecord,
  threadsFromThreadRecords,
} from "../protocol/thread";
import { appServerThreadGoalUpdate, threadGoalFromAppServerGoal } from "../protocol/thread-goal";
import { appServerRuntimeSettingsPatch } from "../protocol/thread-settings";
import {
  completedTurnTranscriptSummariesFromTurnRecords,
  referencedThreadTurnsFromNewestFirstTurnRecords,
  type TurnRecord,
  transcriptEntriesFromTurnRecords,
} from "../protocol/turn";
import type { AppServerRequestClient } from "./request-client";

export type ThreadTurnSortDirection = "asc" | "desc";

interface TurnTranscriptSummaryPage {
  summaries: TurnTranscriptSummary[];
  nextCursor: string | null;
}

interface ThreadActivationResponse extends Partial<RuntimePermissionState> {
  thread: ThreadRecord;
  cwd: string;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  reasoningEffort: string | null;
  sandbox?: RuntimePermissionState["sandboxPolicy"];
}

export interface AppServerStartThreadOptions {
  cwd: string;
  serviceTier?: RuntimeServiceTierRequest;
  permissions?: RuntimeSettingsPatch["permissions"];
}

export interface AppServerStartEphemeralThreadOptions {
  cwd: string;
  serviceName: string;
  developerInstructions: string;
}

export interface AppServerThreadListOptions {
  archived?: boolean;
  sectionId?: string | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface ThreadPage {
  readonly threads: readonly Thread[];
  readonly nextCursor: string | null;
  readonly fetchedSize: number;
}

export function startThread(
  client: AppServerRequestClient,
  options: AppServerStartThreadOptions,
): Promise<ClientResponseByMethod["thread/start"]> {
  const { cwd, serviceTier, permissions } = options;
  return client.request("thread/start", {
    cwd,
    serviceName: "codex-panel",
    historyMode: "paginated",
    ...(serviceTier !== undefined ? { serviceTier } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
  });
}

export function startEphemeralThread(
  client: AppServerRequestClient,
  options: AppServerStartEphemeralThreadOptions,
): Promise<ClientResponseByMethod["thread/start"]> {
  const { cwd, serviceName, developerInstructions } = options;
  return client.request("thread/start", {
    cwd,
    serviceName,
    developerInstructions,
    ephemeral: true,
    sandbox: "read-only",
    approvalPolicy: "never",
    environments: [],
  });
}

export function resumeThread(
  client: AppServerRequestClient,
  threadId: string,
  cwd: string,
): Promise<ClientResponseByMethod["thread/resume"]> {
  return client.request("thread/resume", {
    threadId,
    cwd,
    excludeTurns: true,
    initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "full" },
  });
}

export async function listThreads(
  client: AppServerRequestClient,
  cwd: string,
  options: { archived?: boolean; sectionId?: string | null; signal?: AbortSignal } = {},
): Promise<Thread[]> {
  const archived = options.archived ?? false;
  const threads: Thread[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (;;) {
    options.signal?.throwIfAborted();
    const page = await readThreadPage(client, cwd, {
      archived,
      ...(options.sectionId === undefined ? {} : { sectionId: options.sectionId }),
      cursor,
    });
    threads.push(...page.threads);

    cursor = page.nextCursor;
    if (!cursor) break;
    if (seenCursors.has(cursor)) {
      throw new Error("Codex app-server returned a repeated thread list cursor.");
    }
    seenCursors.add(cursor);
  }

  return threads;
}

export async function readThreadPage(
  client: AppServerRequestClient,
  cwd: string,
  options: AppServerThreadListOptions = {},
): Promise<ThreadPage> {
  const archived = options.archived ?? false;
  const page = await readThreadRecordPage(client, cwd, {
    ...options,
    archived,
  });
  const threads = threadsFromThreadRecords(page.data, { archived });
  return {
    threads,
    nextCursor: page.nextCursor ?? null,
    fetchedSize: threads.length,
  };
}

export function threadFromAppServerRecord(thread: ThreadRecord, options: { archived?: boolean } = {}): Thread {
  return threadFromThreadRecord(thread, options);
}

export async function readThreadForArchiveExport(client: AppServerRequestClient, threadId: string): Promise<ArchiveThreadInput> {
  const metadata = await client.request("thread/read", { threadId, includeTurns: false });
  const thread = threadFromThreadRecord(metadata.thread, { archived: true });
  if (metadata.thread.historyMode !== "paginated") return readLegacyThreadForArchiveExport(client, threadId);

  const turns = await readCompletePaginatedThreadHistory(client, threadId);
  return {
    ...thread,
    transcriptEntries: transcriptEntriesFromTurnRecords(turns),
  };
}

const ARCHIVE_HISTORY_PAGE_LIMIT = 100;

async function readLegacyThreadForArchiveExport(client: AppServerRequestClient, threadId: string): Promise<ArchiveThreadInput> {
  const response = await client.request("thread/read", { threadId, includeTurns: true });
  return {
    ...threadFromThreadRecord(response.thread, { archived: true }),
    transcriptEntries: transcriptEntriesFromTurnRecords(response.thread.turns),
  };
}

async function readCompletePaginatedThreadHistory(client: AppServerRequestClient, threadId: string): Promise<TurnRecord[]> {
  const turns = await readAllArchiveTurns(client, threadId);
  const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (;;) {
    const page = await client.request("thread/items/list", {
      threadId,
      cursor,
      limit: ARCHIVE_HISTORY_PAGE_LIMIT,
      sortDirection: "asc",
    });
    for (const entry of page.data) {
      const turn = turnsById.get(entry.turnId);
      if (!turn) throw new Error(`Codex app-server returned an archive item for unknown turn ${entry.turnId}.`);
      turn.items.push(entry.item);
    }
    cursor = advancingArchiveCursor(cursor, page.nextCursor, seenCursors, "item");
    if (!cursor) break;
  }
  for (const turn of turns) turn.itemsView = "full";
  return turns;
}

async function readAllArchiveTurns(client: AppServerRequestClient, threadId: string): Promise<TurnRecord[]> {
  const turns: TurnRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await client.request("thread/turns/list", {
      threadId,
      cursor,
      limit: ARCHIVE_HISTORY_PAGE_LIMIT,
      sortDirection: "asc",
      itemsView: "notLoaded",
    });
    turns.push(...page.data.map((turn) => ({ ...turn, items: [] })));
    cursor = advancingArchiveCursor(cursor, page.nextCursor, seenCursors, "turn");
    if (!cursor) return turns;
  }
}

function advancingArchiveCursor(current: string | null, next: string | null, seen: Set<string>, kind: "item" | "turn"): string | null {
  if (!next) return null;
  if (next === current || seen.has(next)) throw new Error(`Codex app-server returned a repeated archive ${kind} cursor.`);
  seen.add(next);
  return next;
}

export async function readCompletedTurnTranscriptSummariesPage(
  client: AppServerRequestClient,
  threadId: string,
  cursor: string | null,
  limit: number,
  sortDirection: ThreadTurnSortDirection = "asc",
): Promise<TurnTranscriptSummaryPage> {
  const response = await listThreadTurns(client, threadId, cursor, limit, sortDirection);
  return {
    summaries: completedTurnTranscriptSummariesFromTurnRecords(response.data),
    nextCursor: response.nextCursor,
  };
}

export async function readReferencedThreadTranscriptPage(
  client: AppServerRequestClient,
  threadId: string,
  limit = REFERENCED_THREAD_TURN_LIMIT,
): Promise<ReferencedThreadTranscriptPage> {
  const response = await listThreadTurns(client, threadId, null, limit);
  return {
    turns: referencedThreadTurnsFromNewestFirstTurnRecords(response.data),
    earlierTurnsAvailable: response.nextCursor !== null,
  };
}

type ThreadForkPosition =
  | { readonly kind: "through-turn"; readonly turnId: string }
  | { readonly kind: "before-turn"; readonly turnId: string };

interface AppServerForkThreadOptions {
  readonly position?: ThreadForkPosition;
  readonly deferGoalContinuation?: boolean;
  readonly runtime?: {
    readonly model?: string;
    readonly reasoningEffort?: string | null;
    readonly serviceTier?: ServiceTier | null;
    readonly approvalPolicy?: RuntimePermissionState["approvalPolicy"];
    readonly approvalsReviewer?: ApprovalsReviewer;
    readonly permissions?: string;
    readonly sandboxPolicy?: RuntimePermissionState["sandboxPolicy"];
  };
}

export async function forkThread(
  client: AppServerRequestClient,
  threadId: string,
  cwd: string,
  options: AppServerForkThreadOptions = {},
): Promise<Thread> {
  const position = options.position;
  const runtime = options.runtime;
  const permissions = runtime?.permissions;
  const sandbox = permissions === undefined ? appServerSandboxMode(runtime?.sandboxPolicy) : undefined;
  const response = await client.request("thread/fork", {
    threadId,
    cwd,
    excludeTurns: true,
    ...(position?.kind === "through-turn" ? { lastTurnId: position.turnId } : {}),
    ...(position?.kind === "before-turn" ? { beforeTurnId: position.turnId } : {}),
    ...(options.deferGoalContinuation ? { deferGoalContinuation: true } : {}),
    ...(runtime?.model !== undefined ? { model: runtime.model } : {}),
    ...(runtime?.serviceTier !== undefined ? { serviceTier: runtime.serviceTier } : {}),
    ...(runtime?.approvalPolicy !== undefined && runtime.approvalPolicy !== null ? { approvalPolicy: runtime.approvalPolicy } : {}),
    ...(runtime?.approvalsReviewer !== undefined ? { approvalsReviewer: runtime.approvalsReviewer } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(runtime?.reasoningEffort !== undefined ? { config: { model_reasoning_effort: runtime.reasoningEffort } } : {}),
  });
  return threadFromThreadRecord(response.thread);
}

function appServerSandboxMode(
  policy: RuntimePermissionState["sandboxPolicy"] | undefined,
): "read-only" | "workspace-write" | "danger-full-access" | undefined {
  if (!policy || policy.type === "externalSandbox") return undefined;
  if (policy.type === "dangerFullAccess") return "danger-full-access";
  if (policy.type === "readOnly") return "read-only";
  return "workspace-write";
}

export async function compactThread(client: AppServerRequestClient, threadId: string): Promise<void> {
  await client.request("thread/compact/start", { threadId });
}

export async function archiveThread(client: AppServerRequestClient, threadId: string): Promise<void> {
  await client.request("thread/archive", { threadId });
}

export async function deleteThread(client: AppServerRequestClient, threadId: string, options: { timeoutMs?: number } = {}): Promise<void> {
  await client.request("thread/delete", { threadId }, options);
}

export async function unsubscribeThread(
  client: AppServerRequestClient,
  threadId: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  await client.request("thread/unsubscribe", { threadId }, options);
}

export async function restoreArchivedThread(client: AppServerRequestClient, threadId: string): Promise<Thread> {
  const response = await client.request("thread/unarchive", { threadId });
  return threadFromThreadRecord(response.thread);
}

export function threadActivationSnapshotFromAppServerResponse(response: ThreadActivationResponse): ThreadActivationSnapshot {
  const permissions = runtimePermissionStateOrDefault({
    approvalPolicy: response.approvalPolicy ?? null,
    sandboxPolicy: response.sandbox ?? response.sandboxPolicy ?? null,
    activePermissionProfile: response.activePermissionProfile ?? null,
  });
  return {
    thread: threadFromThreadRecord(response.thread),
    canAcceptDirectInput: typeof response.thread.canAcceptDirectInput === "boolean" ? response.thread.canAcceptDirectInput : null,
    approvalPolicyKnown: "approvalPolicy" in response,
    sandboxPolicyKnown: "sandbox" in response || "sandboxPolicy" in response,
    permissionProfileKnown: "activePermissionProfile" in response,
    model: response.model,
    reasoningEffort: normalizeReasoningEffort(response.reasoningEffort),
    serviceTier: parseServiceTier(response.serviceTier),
    approvalsReviewer: response.approvalsReviewer,
    ...permissions,
  };
}

export async function readThreadGoal(client: AppServerRequestClient, threadId: string): Promise<ThreadGoal | null> {
  const response = await client.request("thread/goal/get", { threadId });
  return threadGoalFromAppServerGoal(response.goal);
}

export async function setThreadGoal(
  client: AppServerRequestClient,
  threadId: string,
  params: ThreadGoalUpdate,
): Promise<ThreadGoal | null> {
  const response = await client.request("thread/goal/set", { threadId, ...appServerThreadGoalUpdate(params) });
  return threadGoalFromAppServerGoal(response.goal);
}

export async function clearThreadGoal(client: AppServerRequestClient, threadId: string): Promise<void> {
  await client.request("thread/goal/clear", { threadId });
}

export async function renameThread(client: AppServerRequestClient, threadId: string, name: string): Promise<void> {
  await client.request("thread/name/set", { threadId, name });
}

export async function setThreadPinned(client: AppServerRequestClient, threadId: string, isPinned: boolean): Promise<void> {
  const sectionId = isPinned ? await pinnedThreadSectionId(client) : null;
  if (isPinned && sectionId === null) throw new Error("Codex app-server did not provide its built-in Pinned thread section.");
  await client.request("thread/section/move", { threadId, sectionId });
}

export async function listPinnedThreads(
  client: AppServerRequestClient,
  cwd: string,
  options: { archived?: boolean; signal?: AbortSignal } = {},
): Promise<Thread[]> {
  const sectionId = await pinnedThreadSectionId(client, options.signal);
  return sectionId === null ? [] : listThreads(client, cwd, { ...options, sectionId });
}

export async function updateThreadSettings(
  client: AppServerRequestClient,
  threadId: string,
  settings: RuntimeSettingsPatch,
): Promise<void> {
  await client.request("thread/settings/update", { threadId, ...appServerRuntimeSettingsPatch(settings) });
}

export function listThreadTurns(
  client: AppServerRequestClient,
  threadId: string,
  cursor: string | null = null,
  limit = 20,
  sortDirection: ClientRequestParams<"thread/turns/list">["sortDirection"] = "desc",
  itemsView: ClientRequestParams<"thread/turns/list">["itemsView"] = "full",
) {
  return client.request("thread/turns/list", {
    threadId,
    cursor,
    limit,
    sortDirection,
    itemsView,
  });
}

function readThreadRecordPage(client: AppServerRequestClient, cwd: string, options: AppServerThreadListOptions) {
  return client.request("thread/list", {
    cwd,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    archived: options.archived ?? false,
    ...(options.sectionId === undefined ? {} : { sectionId: options.sectionId }),
    sortKey: "recency_at",
    sortDirection: "desc",
  });
}

async function pinnedThreadSectionId(client: AppServerRequestClient, signal?: AbortSignal): Promise<string | null> {
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    signal?.throwIfAborted();
    const response: ClientResponseByMethod["threadSection/list"] = await client.request("threadSection/list", { cursor, limit: 100 });
    const pinned = response.data.find((section) => section.name === BUILT_IN_PINNED_THREAD_SECTION_NAME);
    if (pinned) return pinned.id;
    cursor = response.nextCursor;
    if (!cursor) return null;
    if (seenCursors.has(cursor)) throw new Error("Codex app-server returned a repeated thread section list cursor.");
    seenCursors.add(cursor);
  }
}
