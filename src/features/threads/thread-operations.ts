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
    notifyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
    notifyThreadRenamed(threadId: string, name: string | null): void;
    refreshFromOpenSurface(): void;
  };
  notice(message: string): void;
}

export interface ArchiveThreadOptions {
  saveMarkdown?: boolean;
  closeOpenPanels?: boolean;
}

export interface RenameThreadResult {
  name: string;
}

export interface RenameThreadOptions {
  shouldPublish?: () => boolean;
}

export class ThreadOperations {
  constructor(private readonly host: ThreadOperationsHost) {}

  async renameThread(threadId: string, value: string, options: RenameThreadOptions = {}): Promise<RenameThreadResult | null> {
    const rename = threadRenameFromValue(value);
    if (!rename) return null;

    await this.host.connection.ensureConnected();
    return this.renameConnectedThread(threadId, rename, options);
  }

  private async renameConnectedThread(
    threadId: string,
    rename: ThreadRename,
    options: RenameThreadOptions = {},
  ): Promise<RenameThreadResult | null> {
    const client = this.host.connection.currentClient();
    if (!client) return null;

    const result = await renameThreadOnAppServer(client, threadId, rename);
    if (options.shouldPublish?.() ?? true) {
      this.host.catalog.notifyThreadRenamed(threadId, result.name);
    }
    return { name: result.name };
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
    this.host.catalog.notifyThreadArchived(threadId, notificationOptions);
    return result;
  }
}
