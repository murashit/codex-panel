import { inheritedForkThreadName } from "../../../domain/threads/model";
import { chatTurnBusy } from "../state/reducer";
import { turnsAfterTurnId } from "../display/item-actions";
import { archiveThreadOnServer } from "./archive-actions";
import type { ChatThreadActionsHost } from "./action-context";
import { threadActionState, threadActionStillTargetsOriginalPanel } from "./action-context";

export function forkThread(host: ChatThreadActionsHost, threadId: string): Promise<void> {
  return forkThreadFromTurn(host, threadId, null, false);
}

export async function forkThreadFromTurn(
  host: ChatThreadActionsHost,
  threadId: string,
  turnId: string | null,
  archiveSource: boolean,
): Promise<void> {
  if (chatTurnBusy(threadActionState(host))) {
    host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
    return;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;

  const initialActiveThreadId = threadActionState(host).activeThread.id;
  const turnsToDrop = turnId ? turnsAfterTurnId(threadActionState(host).messageStream.displayItems, turnId) : 0;
  if (turnsToDrop === null) {
    host.addSystemMessage("Could not find the selected turn to fork.");
    return;
  }

  try {
    const sourceName = inheritedForkThreadName(threadId, threadActionState(host).threadList.listedThreads);
    const response = await client.forkThread(threadId, host.vaultPath);
    const forkedThreadId = response.thread.id;
    if (turnsToDrop > 0) {
      await client.rollbackThread(forkedThreadId, turnsToDrop);
    }
    if (!threadActionStillTargetsOriginalPanel(threadActionState(host), initialActiveThreadId, threadId)) return;
    if (sourceName) {
      try {
        await client.setThreadName(forkedThreadId, sourceName);
        host.notifyThreadRenamed(forkedThreadId, sourceName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not copy the source thread name: ${message}`);
      }
    }
    if (archiveSource) {
      if (!(await archiveThreadOnServer(host, threadId))) return;
      try {
        await host.openThreadInCurrentPanel(forkedThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        host.addSystemMessage(`Archived thread ${threadId}, but could not open forked thread ${forkedThreadId}: ${message}`);
      }
      host.notifyThreadArchived(threadId);
      return;
    }
    try {
      await host.openThreadInNewView(forkedThreadId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.addSystemMessage(`Forked thread ${forkedThreadId}, but could not open it in a new panel: ${message}`);
    }
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}
