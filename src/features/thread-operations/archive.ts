import type { AppServerClient } from "../../app-server/connection/client";
import { readThreadForArchiveExport } from "../../app-server/services/threads";
import type { CodexPanelSettings } from "../../settings/model";
import { exportArchivedThreadMarkdown, type ArchiveExportAdapter } from "./archive-markdown";

export interface ArchiveThreadOptions {
  settings: CodexPanelSettings;
  vaultPath: string;
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
      { ...options.settings, vaultPath: options.vaultPath },
      options.archiveAdapter(),
    );
    exportedPath = result.path;
  }

  await client.archiveThread(threadId);
  return { exportedPath };
}
