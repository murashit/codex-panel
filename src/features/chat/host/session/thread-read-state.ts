import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { acknowledgeThreadReceipt, readThreadReceipt, threadReadReceipt } from "../../../../app-server/services/threads";
import { activeThreadId } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";

interface ThreadReadStateHost {
  stateStore: ChatStateStore;
  currentClient(): AppServerClient | null;
  isForeground(): boolean;
}

interface ReadScope {
  client: AppServerClient;
  threadId: string;
  targetRevision: number;
  acknowledging: Set<string>;
}

export function createSessionThreadReadState(host: ThreadReadStateHost) {
  const { stateStore } = host;
  let disposed = false;
  let scope: ReadScope | null = null;
  const current = (request: ReadScope): boolean => scope === request && host.currentClient() === request.client;

  const refresh = async (request: ReadScope, onRefresh: "acknowledge" | "display-only"): Promise<void> => {
    const before = stateStore.getState().threadReadReceipt;
    try {
      const receipt = await readThreadReceipt(request.client, request.threadId);
      if (!current(request) || stateStore.getState().threadReadReceipt !== before) return;
      stateStore.dispatch({ type: "active-thread/read-receipt-set", receipt });
      if (onRefresh === "acknowledge") activate();
    } catch {
      // Keep the last receipt when a metadata refresh fails; reconnect refreshes it again.
    }
  };

  const activate = (): void => {
    sync();
    const request = scope;
    const receipt = stateStore.getState().threadReadReceipt;
    if (!request || !receipt?.unread || !host.isForeground() || request.acknowledging.has(receipt.revision)) return;
    request.acknowledging.add(receipt.revision);
    void acknowledgeThreadReceipt(request.client, request.threadId, receipt.revision)
      .then(
        (next) => {
          if (!current(request) || stateStore.getState().threadReadReceipt?.revision !== receipt.revision) return;
          stateStore.dispatch({ type: "active-thread/read-receipt-set", receipt: next });
        },
        () => {
          if (!current(request) || stateStore.getState().threadReadReceipt?.revision !== receipt.revision) return;
          void refresh(request, "display-only");
        },
      )
      .finally(() => {
        request.acknowledging.delete(receipt.revision);
      });
  };

  const sync = (): void => {
    if (disposed) return;
    const state = stateStore.getState();
    const client = host.currentClient();
    const threadId = activeThreadId(state);
    if (!client || !threadId) {
      scope = null;
    } else if (scope?.client !== client || scope.threadId !== threadId || scope.targetRevision !== state.panelTargetRevision) {
      scope = { client, threadId, targetRevision: state.panelTargetRevision, acknowledging: new Set() };
      void refresh(scope, "acknowledge");
    }
  };
  const unsubscribe = stateStore.subscribe(sync);
  sync();

  return {
    activate,
    receive: (notification: Extract<ServerNotification, { method: "thread/readState/changed" }>["params"]): void => {
      sync();
      if (!scope || notification.threadId !== scope.threadId) return;
      stateStore.dispatch({ type: "active-thread/read-receipt-set", receipt: threadReadReceipt(notification.readState) });
      activate();
    },
    dispose: (): void => {
      disposed = true;
      scope = null;
      unsubscribe();
    },
  };
}

export type SessionThreadReadState = ReturnType<typeof createSessionThreadReadState>;
