import { activeThreadId } from "../state/selectors";
import type { ChatConnectionPhase, ChatStateStore } from "../state/reducer";

export interface ChatReconnectActionsHost {
  stateStore: ChatStateStore;
  invalidateConnectionWork: () => void;
  invalidateResumeWork: () => void;
  clearDeferredDiagnostics: () => void;
  reconnect: () => void;
  clearClient: () => void;
  setStatus: (statusText: string, phase?: ChatConnectionPhase) => void;
  ensureConnected: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export interface ChatReconnectActions {
  reconnectPanel: () => Promise<void>;
}

export function createChatReconnectActions(host: ChatReconnectActionsHost): ChatReconnectActions {
  return {
    reconnectPanel: () => reconnectPanel(host),
  };
}

async function reconnectPanel(host: ChatReconnectActionsHost): Promise<void> {
  const threadId = activeThreadId(host.stateStore.getState());
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  host.invalidateConnectionWork();
  host.invalidateResumeWork();
  host.clearDeferredDiagnostics();
  host.reconnect();
  host.clearClient();
  host.stateStore.dispatch({ type: "turn/scoped-cleared" });
  host.setStatus("Reconnecting...", { kind: "connecting" });

  await host.ensureConnected();
  if (!threadId) return;
  try {
    await host.resumeThread(threadId);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}
