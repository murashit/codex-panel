import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { EphemeralStructuredTurnRunner } from "../../../app-server/services/ephemeral-structured-turn";
import { generateThreadTitleWithCodex } from "../../../app-server/services/thread-title-generation";
import {
  archiveThread,
  readCompletedTurnTranscriptSummariesPage,
  readThreadForArchiveExport,
  renameThread,
  setThreadPinned,
} from "../../../app-server/services/threads";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import { findThreadTitleContext } from "../../../domain/threads/title-generation-model";
import type { KeyedOperationCoordinator } from "../../../shared/runtime/keyed-operation-coordinator";
import type { ThreadMutationPort, ThreadTitlePort } from "../workflows/ports";

export function createThreadMutationAdapter(
  clientAccess: AppServerClientAccess,
  lifecycleMutations: KeyedOperationCoordinator<string>,
): ThreadMutationPort {
  return {
    renameThread: (threadId, name) => clientAccess.withClient((client) => renameThread(client, threadId, name)),
    setThreadPinned: (threadId, isPinned) => clientAccess.withClient((client) => setThreadPinned(client, threadId, isPinned)),
    archiveThread: (threadId, prepare) =>
      lifecycleMutations.run(threadId, () =>
        clientAccess.withClient(async (client) => {
          const prepared = prepare ? await prepare(await readThreadForArchiveExport(client, threadId)) : null;
          await archiveThread(client, threadId);
          return prepared;
        }),
      ),
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
    persistedContext: (threadId) =>
      options.clientAccess.withClient((client) =>
        findThreadTitleContext({
          threadId,
          readTurns: (id, cursor, limit, sortDirection) =>
            readCompletedTurnTranscriptSummariesPage(client, id, cursor, limit, sortDirection),
        }),
      ),
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
