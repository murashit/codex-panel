import type { AppServerClient } from "../../../app-server/client";
import { upsertThread } from "../../../domain/threads/model";
import type { Thread } from "../../../generated/app-server/v2/Thread";
import { requestedOrConfiguredServiceTier, type RuntimeSnapshot } from "../../../runtime/effective-settings";
import { resumedThreadAction } from "../thread-resume";
import type { ChatAppServerBaseHost } from "./shared";

export interface ChatAppServerThreadActionsHost extends ChatAppServerBaseHost {
  runtimeSnapshot: () => RuntimeSnapshot;
  forceMessagesToBottom: () => void;
  publishThreadList: (threads: readonly Thread[]) => void;
  syncThreadGoal: (threadId: string) => void;
}

export interface ChatAppServerThreadActions {
  applyThreadList: (threads: readonly Thread[]) => void;
  loadThreadList: () => Promise<readonly Thread[]>;
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<Awaited<ReturnType<AppServerClient["startThread"]>> | null>;
}

export function createChatAppServerThreadActions(host: ChatAppServerThreadActionsHost): ChatAppServerThreadActions {
  return {
    applyThreadList: (threads) => {
      applyThreadList(host, threads);
    },
    loadThreadList: () => loadThreadList(host),
    startThread: (preview, options) => startThread(host, preview, options),
  };
}

function applyThreadList(host: ChatAppServerThreadActionsHost, threads: readonly Thread[]): void {
  host.stateStore.dispatch({ type: "thread-list/applied", threads, threadsLoaded: true });
}

async function loadThreadList(host: ChatAppServerThreadActionsHost): Promise<readonly Thread[]> {
  const client = host.currentClient();
  if (!client) throw new Error("Codex app-server is not connected.");
  const response = await client.listThreads(host.vaultPath);
  return response.data;
}

async function startThread(
  host: ChatAppServerThreadActionsHost,
  preview?: string,
  options: { syncGoal?: boolean } = {},
): Promise<Awaited<ReturnType<AppServerClient["startThread"]>> | null> {
  const client = host.currentClient();
  if (!client) return null;
  const serviceTier = requestedOrConfiguredServiceTier(host.runtimeSnapshot());
  const response = await client.startThread(host.vaultPath, serviceTier);
  const state = host.stateStore.getState();
  const fallbackPreview = preview?.trim();
  const thread =
    response.thread.preview.trim().length > 0 || !fallbackPreview ? response.thread : { ...response.thread, preview: fallbackPreview };
  const listedThreads = upsertThread(state.threadList.listedThreads, thread);
  const resumedResponse = thread === response.thread ? response : { ...response, thread };
  host.stateStore.dispatch(resumedThreadAction({ response: resumedResponse, listedThreads, forceMessagesToBottom: true }));
  host.publishThreadList(listedThreads);
  host.forceMessagesToBottom();
  if (options.syncGoal ?? true) host.syncThreadGoal(response.thread.id);
  return response;
}
