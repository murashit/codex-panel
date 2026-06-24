import type { ArchiveExportAdapter, ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import type { AppServerClient } from "../connection/client";
import { readThreadForArchiveExport } from "../threads";
import { exportArchivedThreadMarkdown } from "./thread-archive-markdown";

export interface ArchiveThreadOptions {
  settings: ArchiveExportSettings;
  vaultPath: string;
  vaultConfigDir: string;
  archiveAdapter: () => ArchiveExportAdapter;
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
      options.archiveAdapter(),
    );
    exportedPath = result.path;
  }

  await client.archiveThread(threadId);
  return { exportedPath };
}
