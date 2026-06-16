import type { AppServerClient } from "../connection/client";
import type { SortDirection } from "../../generated/app-server/v2/SortDirection";
import type { ThreadRollbackResponse } from "../../generated/app-server/v2/ThreadRollbackResponse";
import { threadFromThreadRecord, threadsFromThreadRecords, type ThreadRecord } from "../protocol/thread";
import {
  chronologicalConversationSummariesFromTurnRecords,
  completedConversationSummariesFromTurnRecords,
  transcriptEntriesFromTurnRecords,
  type TurnItem,
} from "../protocol/turn";
import type { HistoricalTurn } from "../../domain/threads/history";
import type { Thread } from "../../domain/threads/model";
import { REFERENCED_THREAD_TURN_LIMIT } from "../../domain/threads/reference";
import type { ArchiveableThread, ThreadConversationSummaryPage } from "../../domain/threads/snapshot";
import type { ThreadConversationSummary } from "../../domain/threads/transcript";

const THREAD_LIST_PAGE_LIMIT = 100;

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

export async function readThreadForArchiveExport(client: AppServerClient, threadId: string): Promise<ArchiveableThread> {
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
  sortDirection: SortDirection = "asc",
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
  turns: readonly HistoricalTurn<TurnItem>[];
}

function threadRollbackSnapshotFromAppServerResponse(response: ThreadRollbackResponse): ThreadRollbackSnapshot {
  return {
    thread: threadFromThreadRecord(response.thread),
    cwd: response.thread.cwd,
    turns: response.thread.turns,
  };
}

export async function rollbackThread(client: AppServerClient, threadId: string): Promise<ThreadRollbackSnapshot> {
  return threadRollbackSnapshotFromAppServerResponse(await client.rollbackThread(threadId));
}

export async function restoreArchivedThread(client: AppServerClient, threadId: string): Promise<Thread> {
  const response = await client.unarchiveThread(threadId);
  return threadFromThreadRecord(response.thread);
}

export async function deleteArchivedThread(client: AppServerClient, threadId: string): Promise<void> {
  await client.deleteThread(threadId);
}
