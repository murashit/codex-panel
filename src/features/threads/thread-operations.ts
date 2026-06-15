import type { AppServerClient } from "../../app-server/connection/client";
import { archiveThreadOnAppServer, type ArchiveThreadResult } from "../../app-server/services/thread-archive";
import type { ArchiveExportAdapter } from "../../app-server/services/thread-archive-markdown";
import { renameThreadOnAppServer, threadRenameFromValue, type ThreadRename } from "../../app-server/services/thread-rename";
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

export interface ArchiveThreadOptions {
  saveMarkdown?: boolean;
  closeOpenPanels?: boolean;
}

export interface RenameThreadOptions {
  shouldPublish?: () => boolean;
}

export class ThreadOperations {
  constructor(private readonly host: ThreadOperationsHost) {}

  async renameThread(threadId: string, value: string, options: RenameThreadOptions = {}): Promise<boolean> {
    const rename = threadRenameFromValue(value);
    if (!rename) return false;

    await this.host.connection.ensureConnected();
    return this.renameConnectedThread(threadId, rename, options);
  }

  private async renameConnectedThread(threadId: string, rename: ThreadRename, options: RenameThreadOptions = {}): Promise<boolean> {
    const client = this.host.connection.currentClient();
    if (!client) return false;

    const result = await renameThreadOnAppServer(client, threadId, rename);
    if (options.shouldPublish?.() ?? true) {
      this.host.catalog.renameThreadInCatalog(threadId, result.name);
    }
    return true;
  }

  async archiveThread(threadId: string, options: ArchiveThreadOptions = {}): Promise<ArchiveThreadResult | null> {
    await this.host.connection.ensureConnected();
    const client = this.host.connection.currentClient();
    if (!client) return null;

    const settings = this.host.settings.current();
    const result = await archiveThreadOnAppServer(client, threadId, {
      settings,
      vaultPath: this.host.settings.vaultPath,
      archiveAdapter: () => this.host.archiveAdapter(),
      saveMarkdown: options.saveMarkdown ?? settings.archiveExportEnabled,
    });
    if (result.exportedPath) {
      this.host.notice(`Saved archived thread to ${result.exportedPath}.`);
    }
    const notificationOptions = options.closeOpenPanels === undefined ? undefined : { closeOpenPanels: options.closeOpenPanels };
    this.host.catalog.archiveThreadInCatalog(threadId, notificationOptions);
    return result;
  }
}
