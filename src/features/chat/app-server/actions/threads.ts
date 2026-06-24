import { threadActivationSnapshotFromAppServerResponse } from "../../../../app-server/threads";
import type { Thread } from "../../../../domain/threads/model";
import type { ThreadCatalogEvent } from "../../../../workspace/thread-catalog";
import { resumedThreadAction } from "../../application/state/actions";
import type { ChatState } from "../../application/state/root-reducer";
import { runtimeConfigOrDefault } from "../../domain/runtime/effective";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { serviceTierRequestForThreadStart } from "../runtime/thread-settings-update";
import { type ChatServerActionHost, captureChatServerActionClientScope } from "./host";

interface StartedThreadSummary {
  threadId: string;
}

export interface ChatServerThreadActionsHost extends ChatServerActionHost {
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  applyThreadCatalogEvent: (event: ThreadCatalogEvent) => void;
  syncThreadGoal: (threadId: string) => void;
}

export interface ChatServerThreadActions {
  applyThreadList: (threads: readonly Thread[]) => void;
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<StartedThreadSummary | null>;
}

export function createChatServerThreadActions(host: ChatServerThreadActionsHost): ChatServerThreadActions {
  return {
    applyThreadList: (threads) => {
      applyThreadList(host, threads);
    },
    startThread: (preview, options) => startThread(host, preview, options),
  };
}

function applyThreadList(host: ChatServerThreadActionsHost, threads: readonly Thread[]): void {
  host.stateStore.dispatch({ type: "thread-list/applied", threads, threadsLoaded: true });
}

async function startThread(
  host: ChatServerThreadActionsHost,
  preview?: string,
  options: { syncGoal?: boolean } = {},
): Promise<StartedThreadSummary | null> {
  const scope = captureChatServerActionClientScope(host);
  if (!scope.client) return null;
  const requestState = host.stateStore.getState();
  const serviceTier = serviceTierRequestForThreadStart(
    host.runtimeSnapshotForState(requestState),
    runtimeConfigOrDefault(requestState.connection.runtimeConfig),
  );
  const response = await scope.client.startThread({ cwd: host.vaultPath, serviceTier });
  if (scope.isStale()) return null;
  const state = host.stateStore.getState();
  const fallbackPreview = preview?.trim();
  const activationResponse =
    response.thread.preview.trim().length > 0 || !fallbackPreview
      ? response
      : { ...response, thread: { ...response.thread, preview: fallbackPreview } };
  const action = resumedThreadAction({
    response: threadActivationSnapshotFromAppServerResponse(activationResponse),
    listedThreads: state.threadList.listedThreads,
    preserveRequestedRuntimeSettings: requestState.activeThread.id === null,
  });
  host.stateStore.dispatch(action);
  host.applyThreadCatalogEvent({ type: "thread-started", thread: action.thread });
  if (options.syncGoal ?? true) host.syncThreadGoal(response.thread.id);
  return { threadId: response.thread.id };
}
