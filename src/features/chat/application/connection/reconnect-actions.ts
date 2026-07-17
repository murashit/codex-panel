import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadId, activeThreadState, type ChatConnectionPhase, panelThreadId } from "../state/root-reducer";
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
  resumeThread: (threadId: string) => Promise<boolean>;
  addSystemMessage: (text: string) => void;
}

export async function reconnectPanel(
  host: ChatReconnectActionsHost,
  target: { resumeThreadId: string | null; isCurrent?: () => boolean } | null = null,
): Promise<boolean> {
  const currentState = host.stateStore.getState();
  const panelTarget = capturePanelTargetLease(currentState);
  const threadId = target
    ? target.resumeThreadId
    : activeThreadState(currentState)?.lifetime?.kind === "ephemeral"
      ? null
      : panelThreadId(currentState);
  const isCurrent = target?.isCurrent ?? (() => true);
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  host.invalidateConnectionWork();
  host.invalidateThreadWork();
  host.clearDeferredDiagnostics();
  host.resetConnection();
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.setStatus(STATUS_RECONNECTING, { kind: "connecting" });

  await host.ensureConnected();
  if (!isCurrent() || !host.isConnected() || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
  if (!threadId) return true;
  try {
    if (!(await host.resumeThread(threadId))) return false;
    if (!isCurrent() || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) {
      return false;
    }
    return activeThreadId(host.stateStore.getState()) === threadId;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}
