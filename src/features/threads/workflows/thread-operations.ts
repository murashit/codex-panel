import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import {
  archiveThread as archiveAppServerThread,
  readThreadForArchiveExport,
  renameThread as renameAppServerThread,
} from "../../../app-server/services/threads";
import type { ArchiveExportSettings } from "../../../domain/threads/archive-markdown";
import { normalizeExplicitThreadName } from "../../../domain/threads/model";
import type { ThreadCatalogEventSink } from "../catalog/thread-catalog";
import { type ArchiveExportDestination, exportArchivedThreadMarkdown } from "./archive-export";

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
}

export interface ArchiveThreadResult {
  exportedPath: string | null;
}

interface RenameThreadOptions {
  shouldPublish?: () => boolean;
}

export interface ThreadOperations {
  renameThread(threadId: string, value: string, options?: RenameThreadOptions): Promise<boolean>;
  archiveThread(threadId: string, options?: ArchiveThreadOptions): Promise<ArchiveThreadResult>;
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
): Promise<ArchiveThreadResult> {
  const exportedPath = await host.clientAccess.withClient(async (client) => {
    let path: string | null = null;
    if (options.saveMarkdown ?? host.archiveExport.enabled()) {
      const archiveSettings = host.archiveExport.settings();
      const result = await exportArchivedThreadMarkdown(
        await readThreadForArchiveExport(client, threadId),
        {
          ...archiveSettings,
          vaultPath: host.archiveExport.vaultPath,
          vaultConfigDir: host.archiveExport.vaultConfigDir,
        },
        host.archiveDestination(),
      );
      path = result.path;
    }
    await archiveAppServerThread(client, threadId);
    return path;
  });
  if (exportedPath) {
    host.notice(`Saved archived thread to ${exportedPath}.`);
  }
  host.catalog.apply({ type: "thread-archived", threadId });
  return { exportedPath };
}
