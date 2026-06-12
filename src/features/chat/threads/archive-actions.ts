import { Notice } from "obsidian";

import { readThreadForArchiveExport } from "../../../app-server/services/threads";
import { exportArchivedThreadMarkdown } from "../../thread-export/archive-markdown";
import { chatTurnBusy } from "../state/reducer";
import type { ChatThreadActionsHost } from "./action-context";
import { threadActionState } from "./action-context";

export async function archiveThread(
  host: ChatThreadActionsHost,
  threadId: string,
  saveMarkdown = host.settings().archiveExportEnabled,
): Promise<void> {
  if (await archiveThreadOnServer(host, threadId, saveMarkdown)) {
    host.notifyThreadArchived(threadId);
  }
}

export async function archiveThreadOnServer(
  host: ChatThreadActionsHost,
  threadId: string,
  saveMarkdown = host.settings().archiveExportEnabled,
): Promise<boolean> {
  if (chatTurnBusy(threadActionState(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
    return false;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    const settings = host.settings();
    if (saveMarkdown) {
      const result = await exportArchivedThreadMarkdown(
        await readThreadForArchiveExport(client, threadId),
        { ...settings, vaultPath: host.vaultPath },
        host.archiveAdapter(),
      );
      new Notice(`Saved archived thread to ${result.path}.`);
    }
    await client.archiveThread(threadId);
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}
