import type { AppServerClient } from "../../app-server/connection/client";
import { archiveThreadOnAppServer, type ArchiveThreadResult } from "../../app-server/services/thread-archive";
import type { ArchiveExportAdapter } from "../../app-server/services/thread-archive-markdown";
import { normalizeExplicitThreadName } from "../../domain/threads/model";
import type { CodexPanelSettings } from "../../settings/model";

export interface ThreadOperationsHost {
  connection: {
    ensureConnected(): Promise<void>;
    currentClient(): AppServerClient | null;
  };
  settings: {
    current(): CodexPanelSettings;
    vaultPath: string;
  };
  archiveAdapter(): ArchiveExportAdapter;
  catalog: {
    archiveThreadInCatalog(threadId: string, options?: { closeOpenPanels?: boolean }): void;
    renameThreadInCatalog(threadId: string, name: string | null): void;
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

  await host.connection.ensureConnected();
  const client = host.connection.currentClient();
  if (!client) return false;

  await client.setThreadName(threadId, name);
  if (options.shouldPublish?.() ?? true) {
    host.catalog.renameThreadInCatalog(threadId, name);
  }
  return true;
}

async function archiveThread(
  host: ThreadOperationsHost,
  threadId: string,
  options: ArchiveThreadOptions = {},
): Promise<ArchiveThreadResult | null> {
  await host.connection.ensureConnected();
  const client = host.connection.currentClient();
  if (!client) return null;

  const settings = host.settings.current();
  const result = await archiveThreadOnAppServer(client, threadId, {
    settings,
    vaultPath: host.settings.vaultPath,
    archiveAdapter: () => host.archiveAdapter(),
    saveMarkdown: options.saveMarkdown ?? settings.archiveExportEnabled,
  });
  if (result.exportedPath) {
    host.notice(`Saved archived thread to ${result.exportedPath}.`);
  }
  if (options.closeOpenPanels === undefined) {
    host.catalog.archiveThreadInCatalog(threadId);
  } else {
    host.catalog.archiveThreadInCatalog(threadId, { closeOpenPanels: options.closeOpenPanels });
  }
  return result;
}
