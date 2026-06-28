import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { ThreadCatalogEventSink } from "../../../app-server/query/thread-catalog";
import { type ArchiveThreadResult, archiveThreadOnAppServer } from "../../../app-server/services/thread-archive";
import type { ArchiveExportDestination } from "../../../app-server/services/thread-archive-markdown";
import { renameThread as renameAppServerThread } from "../../../app-server/services/threads";
import type { ArchiveExportSettings } from "../../../domain/threads/archive-markdown";
import { normalizeExplicitThreadName } from "../../../domain/threads/model";

export interface ThreadOperationsHost {
  clientAccess: AppServerClientAccess;
  archiveExport: {
    settings(): ArchiveExportSettings;
    enabled(): boolean;
    vaultPath: string;
    vaultConfigDir: string;
  };
  archiveDestination(): ArchiveExportDestination;
  catalog: ThreadCatalogEventSink;
  notice(message: string): void;
}

interface ArchiveThreadOptions {
  saveMarkdown?: boolean;
  closeOpenPanels?: boolean;
}

interface RenameThreadOptions {
  shouldPublish?: () => boolean;
}

export interface ThreadOperations {
  renameThread(threadId: string, value: string, options?: RenameThreadOptions): Promise<boolean>;
  archiveThread(threadId: string, options?: ArchiveThreadOptions): Promise<ArchiveThreadResult | null>;
}

export function createThreadOperations(host: ThreadOperationsHost): ThreadOperations {
  return {
    renameThread: (threadId, value, options) => renameThread(host, threadId, value, options),
    archiveThread: (threadId, options) => archiveThread(host, threadId, options),
  };
}

async function renameThread(
  host: ThreadOperationsHost,
  threadId: string,
  value: string,
  options: RenameThreadOptions = {},
): Promise<boolean> {
  const name = normalizeExplicitThreadName(value);
  if (!name) return false;

  await host.clientAccess.withClient((client) => renameAppServerThread(client, threadId, name));
  if (options.shouldPublish?.() ?? true) {
    host.catalog.apply({ type: "thread-renamed", threadId, name });
  }
  return true;
}

async function archiveThread(
  host: ThreadOperationsHost,
  threadId: string,
  options: ArchiveThreadOptions = {},
): Promise<ArchiveThreadResult | null> {
  const archiveSettings = host.archiveExport.settings();
  const result = await host.clientAccess.withClient((client) =>
    archiveThreadOnAppServer(client, threadId, {
      settings: archiveSettings,
      vaultPath: host.archiveExport.vaultPath,
      vaultConfigDir: host.archiveExport.vaultConfigDir,
      archiveDestination: () => host.archiveDestination(),
      saveMarkdown: options.saveMarkdown ?? host.archiveExport.enabled(),
    }),
  );
  if (result.exportedPath) {
    host.notice(`Saved archived thread to ${result.exportedPath}.`);
  }
  host.catalog.apply(
    options.closeOpenPanels === undefined
      ? { type: "thread-archived", threadId }
      : { type: "thread-archived", threadId, options: { closeOpenPanels: options.closeOpenPanels } },
  );
  return result;
}
