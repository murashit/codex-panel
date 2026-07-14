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
  isConnected: () => boolean;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export async function reconnectPanel(
  host: ChatReconnectActionsHost,
  target: { resumeThreadId: string | null; isCurrent?: () => boolean } | null = null,
): Promise<boolean> {
  const threadId = target ? target.resumeThreadId : host.stateStore.getState().activeThread.id;
  const isCurrent = target?.isCurrent ?? (() => true);
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  host.invalidateConnectionWork();
  host.invalidateThreadWork();
  host.clearDeferredDiagnostics();
  host.resetConnection();
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.setStatus(STATUS_RECONNECTING, { kind: "connecting" });

  await host.ensureConnected();
  if (!isCurrent() || !host.isConnected()) return false;
  if (!threadId) return true;
  try {
    await host.resumeThread(threadId);
    if (!isCurrent()) return false;
    return host.stateStore.getState().activeThread.id === threadId;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}
