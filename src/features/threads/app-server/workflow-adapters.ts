import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { EphemeralStructuredTurnRunner } from "../../../app-server/services/ephemeral-structured-turn";
import type { AppServerRequestClient } from "../../../app-server/services/request-client";
import {
  archiveThread,
  deleteThread,
  readCompletedTurnTranscriptSummariesPage,
  readThreadForArchiveExport,
  renameThread,
  restoreArchivedThread,
  setThreadPinned,
} from "../../../app-server/services/threads";
import type { ReasoningEffort } from "../../../domain/runtime/catalog";
import { errorMessage } from "../../../domain/text/error-message";
import { type ThreadTitleContext, threadTitleContextFromTurnTranscriptSummary } from "../../../domain/threads/title";
import type { ThreadMutationPort, ThreadTitlePort } from "../workflows/ports";
import { generateThreadTitleWithCodex } from "./thread-title-generation";

export function createThreadMutationAdapter(clientAccess: AppServerClientAccess): ThreadMutationPort {
  return {
    renameThread: (threadId, name) => clientAccess.withClient((client) => renameThread(client, threadId, name)),
    setThreadPinned: (threadId, isPinned) => clientAccess.withClient((client) => setThreadPinned(client, threadId, isPinned)),
    archiveThread: (threadId, { prepare, canArchive }) =>
      clientAccess.withClient(async (client) => {
        const prepared = prepare ? await prepare(await readThreadForArchiveExport(client, threadId)) : null;
        if (!canArchive()) return { kind: "blocked", reason: "thread-busy", exportedPath: prepared };
        try {
          await archiveThread(client, threadId);
        } catch (error) {
          return { kind: "failed", message: errorMessage(error), exportedPath: prepared };
        }
        return { kind: "archived", exportedPath: prepared };
      }),
    restoreThread: (threadId) => clientAccess.withClient((client) => restoreArchivedThread(client, threadId)),
    deleteThread: (threadId) => clientAccess.withClient((client) => deleteThread(client, threadId)),
  };
}

export function createThreadTitleAdapter(options: {
  clientAccess: AppServerClientAccess;
  codexPath: string;
  vaultPath: string;
  threadNamingModel(): string | null;
  threadNamingEffort(): ReasoningEffort | null;
  runner: EphemeralStructuredTurnRunner;
}): ThreadTitlePort {
  return {
    persistedContext: (threadId) => options.clientAccess.withClient((client) => readPersistedTitleContext(client, threadId)),
    generateTitle: (context, signal) =>
      generateThreadTitleWithCodex(
        options.codexPath,
        options.vaultPath,
        context,
        {
          threadNamingModel: options.threadNamingModel(),
          threadNamingEffort: options.threadNamingEffort(),
        },
        { runner: options.runner, signal },
      ),
  };
}

const DEFAULT_CONTEXT_PAGE_LIMIT = 20;
const DEFAULT_CONTEXT_MAX_PAGES = 5;

export async function readPersistedTitleContext(client: AppServerRequestClient, threadId: string): Promise<ThreadTitleContext | null> {
  let cursor: string | null = null;

  for (let page = 0; page < DEFAULT_CONTEXT_MAX_PAGES; page += 1) {
    const response = await readCompletedTurnTranscriptSummariesPage(client, threadId, cursor, DEFAULT_CONTEXT_PAGE_LIMIT);
    for (const summary of response.summaries) {
      const context = threadTitleContextFromTurnTranscriptSummary(summary);
      if (context) return context;
    }
    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return null;
}
