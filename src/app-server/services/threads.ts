import { normalizeReasoningEffort } from "../../domain/catalog/metadata";
import { type RuntimePermissionState, runtimePermissionStateOrDefault } from "../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../domain/runtime/policy";
import { parseServiceTier } from "../../domain/runtime/policy";
import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../domain/runtime/thread-settings";
import type { ThreadActivationSnapshot } from "../../domain/threads/activation";
import type { ArchiveThreadInput } from "../../domain/threads/archive-markdown";
import type { ThreadGoal, ThreadGoalUpdate } from "../../domain/threads/goal";
import type { HistoricalTurn } from "../../domain/threads/history";
import type { Thread } from "../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT } from "../../domain/threads/reference";
import type { TurnTranscriptSummary } from "../../domain/threads/transcript";
import type { ClientResponseByMethod } from "../connection/client";
import type { ClientRequestParams } from "../connection/rpc-messages";
import { appServerSideChatBoundaryItem, sideChatDeveloperInstructions } from "../protocol/side-chat";
import { type ThreadRecord, threadFromThreadRecord, threadsFromThreadRecords } from "../protocol/thread";
import { appServerThreadGoalUpdate, appServerThreadGoalUserHistoryItem, threadGoalFromAppServerGoal } from "../protocol/thread-goal";
import { appServerRuntimeSettingsPatch } from "../protocol/thread-settings";
import {
  chronologicalTurnTranscriptSummariesFromTurnRecords,
  completedTurnTranscriptSummariesFromTurnRecords,
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
  options: { archived?: boolean; signal?: AbortSignal } = {},
): Promise<Thread[]> {
  const archived = options.archived ?? false;
  const threads: Thread[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (;;) {
    options.signal?.throwIfAborted();
    const page = await readThreadPage(client, cwd, {
      archived,
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
  return {
    threads: threadsFromThreadRecords(page.data, { archived }),
    nextCursor: page.nextCursor ?? null,
    fetchedSize: page.data.length,
  };
}

export function threadFromAppServerRecord(thread: ThreadRecord, options: { archived?: boolean } = {}): Thread {
  return threadFromThreadRecord(thread, options);
}

export async function readThreadForArchiveExport(client: AppServerRequestClient, threadId: string): Promise<ArchiveThreadInput> {
  const response = await client.request("thread/read", { threadId, includeTurns: true });
  return {
    ...threadFromThreadRecord(response.thread, { archived: true }),
    transcriptEntries: transcriptEntriesFromTurnRecords(response.thread.turns),
  };
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

export async function readReferencedThreadTurnTranscriptSummaries(
  client: AppServerRequestClient,
  threadId: string,
  limit = REFERENCED_THREAD_TURN_LIMIT,
): Promise<TurnTranscriptSummary[]> {
  const response = await listThreadTurns(client, threadId, null, limit);
  return chronologicalTurnTranscriptSummariesFromTurnRecords(response.data);
}

export interface ThreadRollbackSnapshot {
  thread: Thread;
  cwd: string;
  turns: readonly HistoricalTurn[];
}

interface ThreadRollbackResult {
  readonly thread: ThreadRecord & {
    readonly cwd: string;
    readonly turns: readonly HistoricalTurn[];
  };
}

function threadRollbackSnapshotFromAppServerResponse(response: ThreadRollbackResult): ThreadRollbackSnapshot {
  return {
    thread: threadFromThreadRecord(response.thread),
    cwd: response.thread.cwd,
    turns: response.thread.turns,
  };
}

export async function rollbackThread(client: AppServerRequestClient, threadId: string, numTurns?: number): Promise<ThreadRollbackSnapshot> {
  const response = await client.request("thread/rollback", { threadId, numTurns: numTurns ?? 1 });
  return threadRollbackSnapshotFromAppServerResponse(response);
}

export async function forkThread(
  client: AppServerRequestClient,
  threadId: string,
  cwd: string,
  lastTurnId: string | null = null,
): Promise<Thread> {
  const response = await client.request("thread/fork", {
    threadId,
    cwd,
    excludeTurns: true,
    ...(lastTurnId ? { lastTurnId } : {}),
  });
  return threadFromThreadRecord(response.thread);
}

export interface EphemeralThreadForkSnapshot {
  readonly activation: ThreadActivationSnapshot;
  readonly sourceThreadId: string;
}

export class EphemeralThreadCleanupRequiredError extends Error {
  readonly cleanupError: unknown;
  readonly threadId: string;

  constructor(threadId: string, cause: unknown, cleanupError: unknown) {
    super(`Could not prepare or unsubscribe side chat ${threadId}.`, { cause });
    this.name = "EphemeralThreadCleanupRequiredError";
    this.threadId = threadId;
    this.cleanupError = cleanupError;
  }
}

export async function forkEphemeralThread(
  client: AppServerRequestClient,
  sourceThreadId: string,
  cwd: string,
): Promise<EphemeralThreadForkSnapshot> {
  const source = await client.request("thread/read", { threadId: sourceThreadId, includeTurns: false });
  const config = await client.request("config/read", { cwd: source.thread.cwd });
  const response = await client.request("thread/fork", {
    threadId: sourceThreadId,
    cwd,
    ephemeral: true,
    sandbox: "read-only",
    approvalPolicy: "never",
    developerInstructions: sideChatDeveloperInstructions(config.config.developer_instructions),
    excludeTurns: true,
  });
  try {
    await client.request("thread/inject_items", {
      threadId: response.thread.id,
      items: [appServerSideChatBoundaryItem()],
    });
  } catch (error) {
    try {
      await unsubscribeThread(client, response.thread.id, { timeoutMs: 5_000 });
    } catch (cleanupError) {
      throw new EphemeralThreadCleanupRequiredError(response.thread.id, error, cleanupError);
    }
    throw error;
  }
  return {
    activation: threadActivationSnapshotFromAppServerResponse(response),
    sourceThreadId,
  };
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
    cwd: response.cwd,
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

export async function recordThreadGoalUserMessage(client: AppServerRequestClient, threadId: string, objective: string): Promise<void> {
  await client.request("thread/inject_items", { threadId, items: [appServerThreadGoalUserHistoryItem(objective)] });
}

export async function renameThread(client: AppServerRequestClient, threadId: string, name: string): Promise<void> {
  await client.request("thread/name/set", { threadId, name });
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
    sortKey: "recency_at",
    sortDirection: "desc",
  });
}
