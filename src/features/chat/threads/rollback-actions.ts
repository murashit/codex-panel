import { rollbackThread as rollbackThreadOnAppServer } from "../../../app-server/services/threads";
import { rollbackCandidateFromItems } from "../display/item-actions";
import { displayItemsFromTurns } from "../display/turn-items";
import { chatTurnBusy } from "../state/reducer";
import { messageStreamDisplayItems } from "../state/message-stream";
import type { ChatThreadActionsHost } from "./action-context";
import { threadActionDispatch, threadActionState, threadActionStillTargetsPanel } from "./action-context";
import { resumedThreadActionFromActiveRuntime } from "./resume";

export async function rollbackThread(host: ChatThreadActionsHost, threadId: string): Promise<void> {
  if (chatTurnBusy(threadActionState(host))) {
    host.addSystemMessage("Interrupt the current turn before rolling back.");
    return;
  }
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;

  const candidate = rollbackCandidateFromItems(messageStreamDisplayItems(threadActionState(host).messageStream));
  if (!candidate) {
    host.addSystemMessage("No completed turn to roll back.");
    return;
  }

  try {
    host.setStatus("Rolling back latest turn...");
    const snapshot = await rollbackThreadOnAppServer(client, threadId);
    if (!threadActionStillTargetsPanel(threadActionState(host), threadId)) return;
    threadActionDispatch(
      host,
      resumedThreadActionFromActiveRuntime({
        thread: snapshot.thread,
        cwd: snapshot.cwd,
        runtime: threadActionState(host).runtime,
        listedThreads: threadActionState(host).threadList.listedThreads,
      }),
    );
    threadActionDispatch(host, {
      type: "message-stream/items-replaced",
      items: displayItemsFromTurns(snapshot.turns),
      historyCursor: null,
      loadingHistory: false,
    });
    host.setComposerText(candidate.text);
    host.addSystemMessage("Rolled back the latest turn. Local file changes were not reverted.");
    host.setStatus("Rolled back latest turn.");
    host.notifyActiveThreadIdentityChanged();
    await host.refreshThreads();
    host.refreshSharedThreadListFromOpenSurface();
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    host.setStatus("Rollback failed.");
  }
}
