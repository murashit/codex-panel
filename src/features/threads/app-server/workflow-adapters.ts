import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { EphemeralStructuredTurnRunner } from "../../../app-server/services/ephemeral-structured-turn";
import { generateThreadTitleWithCodex } from "../../../app-server/services/thread-title-generation";
import {
  archiveThread,
  readCompletedTurnTranscriptSummariesPage,
  readThreadForArchiveExport,
  renameThread,
} from "../../../app-server/services/threads";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import { findThreadTitleContext } from "../../../domain/threads/title-generation-model";
import type { ThreadMutationPort, ThreadTitlePort } from "../workflows/ports";

export function createThreadMutationAdapter(clientAccess: AppServerClientAccess): ThreadMutationPort {
  return {
    renameThread: (threadId, name) => clientAccess.withClient((client) => renameThread(client, threadId, name)),
    archiveThread: (threadId, prepare) =>
      clientAccess.withClient(async (client) => {
        const prepared = prepare ? await prepare(await readThreadForArchiveExport(client, threadId)) : null;
        await archiveThread(client, threadId);
        return prepared;
      }),
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
