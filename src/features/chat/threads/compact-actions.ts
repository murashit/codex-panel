import type { ChatThreadActionsHost } from "./action-context";
import { threadActionState, threadActionStillTargetsOriginalPanel } from "./action-context";

export async function compactThread(host: ChatThreadActionsHost, threadId: string): Promise<void> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return;
  const initialActiveThreadId = threadActionState(host).activeThread.id;
  try {
    await client.compactThread(threadId);
    if (!threadActionStillTargetsOriginalPanel(threadActionState(host), initialActiveThreadId, threadId)) return;
    host.addSystemMessage("Compaction requested.");
    host.setStatus("Compaction requested.");
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}
