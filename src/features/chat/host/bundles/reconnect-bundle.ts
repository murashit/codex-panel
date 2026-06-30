import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import type { ConnectionWorkTracker } from "../../../../shared/lifecycle/connection-work";
import { type ChatReconnectActionsHost, reconnectPanel } from "../../application/connection/reconnect-actions";
import type { ChatConnectionPhase } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { ChatViewDeferredTasks } from "../session/deferred-work";

interface ChatPanelReconnectStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
}

interface ChatPanelReconnectHost {
  stateStore: ChatStateStore;
  connectionWork: ConnectionWorkTracker;
  deferredTasks: ChatViewDeferredTasks;
}

interface ChatPanelReconnectInput {
  connection: ConnectionManager;
  ensureConnected: () => Promise<void>;
  invalidateThreadWork: () => void;
  resumeThread: (threadId: string) => Promise<void>;
  status: ChatPanelReconnectStatus;
}

export function createReconnectAction(host: ChatPanelReconnectHost, input: ChatPanelReconnectInput): () => Promise<void> {
  const reconnectHost: ChatReconnectActionsHost = {
    stateStore: host.stateStore,
    invalidateConnectionWork: () => {
      host.connectionWork.invalidate();
    },
    invalidateThreadWork: () => {
      input.invalidateThreadWork();
    },
    clearDeferredDiagnostics: () => {
      host.deferredTasks.clearDiagnostics();
    },
    resetConnection: () => {
      input.connection.resetConnection();
    },
    setStatus: (statusText, phase) => {
      input.status.set(statusText, phase);
    },
    ensureConnected: input.ensureConnected,
    resumeThread: input.resumeThread,
    addSystemMessage: (text) => {
      input.status.addSystemMessage(text);
    },
  };

  return () => reconnectPanel(reconnectHost);
}
