import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadId, activeThreadState, type ChatConnectionPhase, panelThreadId } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

const STATUS_RECONNECTING = "Reconnecting...";

export interface ChatReconnectCommandHost {
  stateStore: ChatStateStore;
  resetConnectionScope: () => void;
  setStatus: (statusText: string, phase?: ChatConnectionPhase) => void;
  ensureConnected: () => Promise<void>;
  isConnected: () => boolean;
  resumeThread: (threadId: string) => Promise<boolean>;
  addSystemMessage: (text: string) => void;
}

export function createReconnectPanelCommand(host: ChatReconnectCommandHost): () => Promise<boolean> {
  let activeReconnect: Promise<boolean> | null = null;
  return async () => {
    if (activeReconnect) return activeReconnect;
    const operation = reconnectPanel(host);
    activeReconnect = operation;
    try {
      return await operation;
    } finally {
      if (activeReconnect === operation) activeReconnect = null;
    }
  };
}

async function reconnectPanel(host: ChatReconnectCommandHost): Promise<boolean> {
  const currentState = host.stateStore.getState();
  const panelTarget = capturePanelTargetLease(currentState);
  const threadId = activeThreadState(currentState)?.lifetime?.kind === "ephemeral" ? null : panelThreadId(currentState);
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  host.resetConnectionScope();
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.setStatus(STATUS_RECONNECTING, { kind: "connecting" });

  await host.ensureConnected();
  if (!host.isConnected() || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
  if (!threadId) return true;
  try {
    if (!(await host.resumeThread(threadId))) return false;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
    return activeThreadId(host.stateStore.getState()) === threadId;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}
