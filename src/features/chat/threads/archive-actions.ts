import { Notice } from "obsidian";

import { threadFromAppServerThread } from "../../../app-server/thread-model";
import { transcriptEntriesFromAppServerTurn } from "../../../app-server/turn-model";
import { exportArchivedThreadMarkdown } from "../../../domain/threads/export";
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
      const response = await client.readThread(threadId, true);
      const result = await exportArchivedThreadMarkdown(
        {
          ...threadFromAppServerThread(response.thread, { archived: true }),
          transcriptEntries: response.thread.turns.flatMap(transcriptEntriesFromAppServerTurn),
        },
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
