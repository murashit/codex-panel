import type { ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import type { AppServerRequestClient } from "./request-client";
import { type ArchiveExportDestination, exportArchivedThreadMarkdown } from "./thread-archive-markdown";
import { archiveThread, readThreadForArchiveExport } from "./threads";

export interface ArchiveThreadOptions {
  settings: ArchiveExportSettings;
  vaultPath: string;
  vaultConfigDir: string;
  archiveDestination: () => ArchiveExportDestination;
  saveMarkdown: boolean;
}

export interface ArchiveThreadResult {
  exportedPath: string | null;
}

export async function archiveThreadOnAppServer(
  client: AppServerRequestClient,
  threadId: string,
  options: ArchiveThreadOptions,
): Promise<ArchiveThreadResult> {
  let exportedPath: string | null = null;
  if (options.saveMarkdown) {
    const result = await exportArchivedThreadMarkdown(
      await readThreadForArchiveExport(client, threadId),
      { ...options.settings, vaultPath: options.vaultPath, vaultConfigDir: options.vaultConfigDir },
      options.archiveDestination(),
    );
    exportedPath = result.path;
  }

  await archiveThread(client, threadId);
  return { exportedPath };
}
