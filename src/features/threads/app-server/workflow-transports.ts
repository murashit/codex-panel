import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import { generateThreadTitleWithCodex } from "../../../app-server/services/thread-title-generation";
import {
  archiveThread,
  readCompletedTurnTranscriptSummariesPage,
  readThreadForArchiveExport,
  renameThread,
} from "../../../app-server/services/threads";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import { findThreadTitleContext } from "../../../domain/threads/title-generation-model";
import type { ThreadOperationsTransport, ThreadTitleTransport } from "../workflows/ports";

export function createThreadOperationsTransport(clientAccess: AppServerClientAccess): ThreadOperationsTransport {
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

export function createThreadTitleTransport(options: {
  clientAccess: AppServerClientAccess;
  codexPath(): string;
  vaultPath: string;
  threadNamingModel(): string | null;
  threadNamingEffort(): ReasoningEffort | null;
}): ThreadTitleTransport {
  return {
    persistedContext: (threadId) =>
      options.clientAccess.withClient((client) =>
        findThreadTitleContext({
          threadId,
          readTurns: (id, cursor, limit, sortDirection) =>
            readCompletedTurnTranscriptSummariesPage(client, id, cursor, limit, sortDirection),
        }),
      ),
    generateTitle: (context) =>
      generateThreadTitleWithCodex(options.codexPath(), options.vaultPath, context, {
        threadNamingModel: options.threadNamingModel(),
        threadNamingEffort: options.threadNamingEffort(),
      }),
  };
}
