import { listThreads } from "../../../../app-server/services/threads";
import type { Thread } from "../../../../domain/threads/model";
import type { RuntimeSnapshot } from "../../application/runtime/snapshot";
import { runtimeConfigOrDefault } from "../../domain/runtime/effective";
import { serviceTierRequestForThreadStart } from "../../application/runtime/thread-settings-update";
import { resumedThreadActionFromAppServerResponse } from "../../application/threads/resume";
import type { ChatServerActionHost } from "./host";
import type { ChatState } from "../../application/state/reducer";

interface StartedThreadSummary {
  threadId: string;
}

export interface ChatServerThreadActionsHost extends ChatServerActionHost {
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  publishThreadList: (threads: readonly Thread[]) => void;
  syncThreadGoal: (threadId: string) => void;
}

export interface ChatServerThreadActions {
  applyThreadList: (threads: readonly Thread[]) => void;
  loadThreadList: () => Promise<readonly Thread[]>;
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<StartedThreadSummary | null>;
}

export function createChatServerThreadActions(host: ChatServerThreadActionsHost): ChatServerThreadActions {
  return {
    applyThreadList: (threads) => {
      applyThreadList(host, threads);
    },
    loadThreadList: () => loadThreadList(host),
    startThread: (preview, options) => startThread(host, preview, options),
  };
}

function applyThreadList(host: ChatServerThreadActionsHost, threads: readonly Thread[]): void {
  host.stateStore.dispatch({ type: "thread-list/applied", threads, threadsLoaded: true });
}

async function loadThreadList(host: ChatServerThreadActionsHost): Promise<readonly Thread[]> {
  const client = host.currentClient();
  if (!client) throw new Error("Codex app-server is not connected.");
  return listThreads(client, host.vaultPath);
}

async function startThread(
  host: ChatServerThreadActionsHost,
  preview?: string,
  options: { syncGoal?: boolean } = {},
): Promise<StartedThreadSummary | null> {
  const client = host.currentClient();
  if (!client) return null;
  const requestState = host.stateStore.getState();
  const serviceTier = serviceTierRequestForThreadStart(
    host.runtimeSnapshotForState(requestState),
    runtimeConfigOrDefault(requestState.connection.runtimeConfig),
  );
  const response = await client.startThread({ cwd: host.vaultPath, serviceTier });
  if (host.currentClient() !== client) return null;
  const state = host.stateStore.getState();
  const fallbackPreview = preview?.trim();
  const activationResponse =
    response.thread.preview.trim().length > 0 || !fallbackPreview
      ? response
      : { ...response, thread: { ...response.thread, preview: fallbackPreview } };
  const action = resumedThreadActionFromAppServerResponse({
    response: activationResponse,
    listedThreads: state.threadList.listedThreads,
    preserveRequestedRuntimeSettings: requestState.activeThread.id === null,
  });
  host.stateStore.dispatch(action);
  if (action.listedThreads) host.publishThreadList(action.listedThreads);
  if (options.syncGoal ?? true) host.syncThreadGoal(response.thread.id);
  return { threadId: response.thread.id };
}
