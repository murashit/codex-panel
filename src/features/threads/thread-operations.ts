import type { AppServerClientAccess } from "../../app-server/connection/client-access";
import { archiveThreadOnAppServer, type ArchiveThreadResult } from "../../app-server/services/thread-archive";
import type { ArchiveExportAdapter, ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import { normalizeExplicitThreadName } from "../../domain/threads/model";

export interface ThreadOperationsHost {
  clientAccess: AppServerClientAccess;
  archiveExport: {
    settings(): ArchiveExportSettings;
    enabled(): boolean;
    vaultPath: string;
    vaultConfigDir: string;
  };
  archiveAdapter(): ArchiveExportAdapter;
  catalog: {
    recordThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
    recordThreadRenamed(threadId: string, name: string | null): void;
  };
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

  await host.clientAccess.withClient((client) => client.setThreadName(threadId, name));
  if (options.shouldPublish?.() ?? true) {
    host.catalog.recordThreadRenamed(threadId, name);
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
      archiveAdapter: () => host.archiveAdapter(),
      saveMarkdown: options.saveMarkdown ?? host.archiveExport.enabled(),
    }),
  );
  if (result.exportedPath) {
    host.notice(`Saved archived thread to ${result.exportedPath}.`);
  }
  if (options.closeOpenPanels === undefined) {
    host.catalog.recordThreadArchived(threadId);
  } else {
    host.catalog.recordThreadArchived(threadId, { closeOpenPanels: options.closeOpenPanels });
  }
  return result;
}
