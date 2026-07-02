import {
  startThread as startAppServerThread,
  threadActivationSnapshotFromAppServerResponse,
} from "../../../../app-server/services/threads";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { Thread } from "../../../../domain/threads/model";
import type { ThreadCatalogEvent } from "../../../threads/catalog/thread-catalog";
import { resumedThreadAction } from "../../application/state/actions";
import type { ChatState } from "../../application/state/root-reducer";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { permissionProfileRequestForThreadStart, serviceTierRequestForThreadStart } from "../../domain/runtime/thread-settings-patch";
import { type ChatServerActionsHost, captureChatServerClientScope } from "./host";

interface StartedThreadSummary {
  threadId: string;
}

export interface ChatServerThreadActionsHost extends ChatServerActionsHost {
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
  const scope = captureChatServerClientScope(host);
  if (!scope.client) return null;
  const requestState = host.stateStore.getState();
  const runtimeSnapshot = host.runtimeSnapshotForState(requestState);
  const runtimeConfig = runtimeConfigOrDefault(requestState.connection.runtimeConfig);
  const serviceTier = serviceTierRequestForThreadStart(runtimeSnapshot, runtimeConfig);
  const permissions = permissionProfileRequestForThreadStart(runtimeSnapshot, runtimeConfig);
  const response = await startAppServerThread(scope.client, { cwd: host.vaultPath, serviceTier, permissions });
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
