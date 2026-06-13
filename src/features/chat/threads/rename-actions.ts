import type { AppServerClient } from "../../../app-server/connection/client";
import type { ChatStateStore } from "../state/reducer";

export interface ThreadRenameActionsHost {
  stateStore: ChatStateStore;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
}

export async function renameThread(host: ThreadRenameActionsHost, threadId: string, value: string): Promise<boolean> {
  const title = value.trim();
  if (!title) return false;

  await host.ensureConnected();
  return renameConnectedThread(host, threadId, title);
}

export async function renameConnectedThread(host: ThreadRenameActionsHost, threadId: string, title: string): Promise<boolean> {
  const client = host.currentClient();
  if (!client) return false;

  try {
    await client.setThreadName(threadId, title);
    host.stateStore.dispatch({
      type: "thread-list/applied",
      threads: host.stateStore
        .getState()
        .threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: title } : thread)),
    });
    host.notifyThreadRenamed(threadId, title);
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}
