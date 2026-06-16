import type { AppServerClient } from "../connection/client";
import { appServerThreadGoalUserHistoryItem, threadGoalFromAppServerGoal } from "../protocol/thread-goal";
import { threadFromThreadRecord, threadsFromThreadRecords, type ThreadRecord } from "../protocol/thread";
import {
  chronologicalConversationSummariesFromTurnRecords,
  completedConversationSummariesFromTurnRecords,
  transcriptEntriesFromTurnRecords,
} from "../protocol/turn";
import { normalizeReasoningEffort } from "../../domain/catalog/metadata";
import type { ActivePermissionProfile, ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "../../domain/runtime/policy";
import { parseServiceTier } from "../../domain/runtime/policy";
import type { ArchiveThreadInput } from "../../domain/threads/archive-markdown";
import type { ThreadActivationSnapshot } from "../../domain/threads/activation";
import type { ThreadGoal, ThreadGoalUpdate } from "../../domain/threads/goal";
import type { HistoricalTurn } from "../../domain/threads/history";
import type { Thread } from "../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT } from "../../domain/threads/reference";
import type { ThreadConversationSummary } from "../../domain/threads/transcript";

const THREAD_LIST_PAGE_LIMIT = 100;

export type ThreadTurnSortDirection = "asc" | "desc";

interface ThreadConversationSummaryPage {
  data: ThreadConversationSummary[];
  nextCursor: string | null;
}

interface ThreadActivationResponse {
  thread: ThreadRecord;
  cwd: string;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: ApprovalPolicy | null;
  approvalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  reasoningEffort: string | null;
}

export async function listThreads(client: AppServerClient, cwd: string, options: { archived?: boolean } = {}): Promise<Thread[]> {
  const archived = options.archived ?? false;
  const records: ThreadRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (;;) {
    const response = await client.listThreads(cwd, {
      archived,
      cursor,
      limit: THREAD_LIST_PAGE_LIMIT,
    });
    records.push(...response.data);

    cursor = response.nextCursor ?? null;
    if (!cursor) break;
    if (seenCursors.has(cursor)) {
      throw new Error("Codex app-server returned a repeated thread list cursor.");
    }
    seenCursors.add(cursor);
  }

  return threadsFromThreadRecords(records, { archived });
}

export function threadFromAppServerRecord(thread: ThreadRecord, options: { archived?: boolean } = {}): Thread {
  return threadFromThreadRecord(thread, options);
}

export async function readThreadForArchiveExport(client: AppServerClient, threadId: string): Promise<ArchiveThreadInput> {
  const response = await client.readThread(threadId, true);
  return {
    ...threadFromThreadRecord(response.thread, { archived: true }),
    transcriptEntries: transcriptEntriesFromTurnRecords(response.thread.turns),
  };
}

export async function readCompletedConversationSummariesPage(
  client: AppServerClient,
  threadId: string,
  cursor: string | null,
  limit: number,
  sortDirection: ThreadTurnSortDirection = "asc",
): Promise<ThreadConversationSummaryPage> {
  const response = await client.threadTurnsList(threadId, cursor, limit, sortDirection);
  return {
    data: completedConversationSummariesFromTurnRecords(response.data),
    nextCursor: response.nextCursor,
  };
}

export async function readReferencedThreadConversationSummaries(
  client: AppServerClient,
  threadId: string,
  limit = REFERENCED_THREAD_TURN_LIMIT,
): Promise<ThreadConversationSummary[]> {
  const response = await client.threadTurnsList(threadId, null, limit);
  return chronologicalConversationSummariesFromTurnRecords(response.data);
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

export async function rollbackThread(client: AppServerClient, threadId: string, numTurns?: number): Promise<ThreadRollbackSnapshot> {
  const response = numTurns === undefined ? await client.rollbackThread(threadId) : await client.rollbackThread(threadId, numTurns);
  return threadRollbackSnapshotFromAppServerResponse(response);
}

export async function forkThread(client: AppServerClient, threadId: string, cwd: string): Promise<Thread> {
  const response = await client.forkThread(threadId, cwd);
  return threadFromThreadRecord(response.thread);
}

export async function restoreArchivedThread(client: AppServerClient, threadId: string): Promise<Thread> {
  const response = await client.unarchiveThread(threadId);
  return threadFromThreadRecord(response.thread);
}

export function threadActivationSnapshotFromAppServerResponse(response: ThreadActivationResponse): ThreadActivationSnapshot {
  return {
    thread: threadFromThreadRecord(response.thread),
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: normalizeReasoningEffort(response.reasoningEffort),
    serviceTier: parseServiceTier(response.serviceTier),
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
  };
}

export async function readThreadGoal(client: AppServerClient, threadId: string): Promise<ThreadGoal | null> {
  const response = await client.getThreadGoal(threadId);
  return threadGoalFromAppServerGoal(response.goal);
}

export async function setThreadGoal(client: AppServerClient, threadId: string, params: ThreadGoalUpdate): Promise<ThreadGoal | null> {
  const response = await client.setThreadGoal(threadId, params);
  return threadGoalFromAppServerGoal(response.goal);
}

export async function recordThreadGoalUserMessage(client: AppServerClient, threadId: string, objective: string): Promise<void> {
  await client.injectThreadItems(threadId, [appServerThreadGoalUserHistoryItem(objective)]);
}
