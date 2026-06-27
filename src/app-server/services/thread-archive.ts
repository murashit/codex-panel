import type { ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import type { AppServerClient } from "../connection/client";
import { type ArchiveExportDestination, exportArchivedThreadMarkdown } from "./thread-archive-markdown";
import { readThreadForArchiveExport } from "./threads";

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
  client: AppServerClient,
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

  await client.archiveThread(threadId);
  return { exportedPath };
}
