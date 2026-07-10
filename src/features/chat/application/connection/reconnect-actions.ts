import type { ChatConnectionPhase } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

const STATUS_RECONNECTING = "Reconnecting...";

export interface ChatReconnectActionsHost {
  stateStore: ChatStateStore;
  invalidateConnectionWork: () => void;
  invalidateThreadWork: () => void;
  clearDeferredDiagnostics: () => void;
  resetConnection: () => void;
  setStatus: (statusText: string, phase?: ChatConnectionPhase) => void;
  ensureConnected: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export async function reconnectPanel(host: ChatReconnectActionsHost): Promise<void> {
  const threadId = host.stateStore.getState().activeThread.id;
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  host.invalidateConnectionWork();
  host.invalidateThreadWork();
  host.clearDeferredDiagnostics();
  host.resetConnection();
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.setStatus(STATUS_RECONNECTING, { kind: "connecting" });

  await host.ensureConnected();
  if (!threadId) return;
  try {
    await host.resumeThread(threadId);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}
