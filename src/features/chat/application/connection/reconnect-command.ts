import { activeThreadId, activeThreadState, type ChatConnectionPhase, panelThreadId } from "../state/model";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import type { ThreadResumeActivation } from "../threads/resume-command";

const STATUS_RECONNECTING = "Reconnecting...";

export interface ChatReconnectCommandHost {
  stateStore: ChatStateStore;
  cleanupForConnectionReset: () => Promise<void>;
  resetConnectionScope: () => void;
  setStatus: (statusText: string, phase?: ChatConnectionPhase) => void;
  ensureConnected: () => Promise<void>;
  isConnected: () => boolean;
  resumeThread: (threadId: string) => Promise<ThreadResumeActivation | null>;
  addSystemMessage: (text: string) => void;
}

export interface ReconnectPanelOptions {
  beforeTargetReset?: () => void;
}

export function createReconnectPanelCommand(host: ChatReconnectCommandHost): (options?: ReconnectPanelOptions) => Promise<boolean> {
  let activeReconnect: Promise<boolean> | null = null;
  return async (options) => {
    if (activeReconnect) return activeReconnect;
    const operation = reconnectPanel(host, options);
    activeReconnect = operation;
    try {
      return await operation;
    } finally {
      if (activeReconnect === operation) activeReconnect = null;
    }
  };
}

async function reconnectPanel(host: ChatReconnectCommandHost, options: ReconnectPanelOptions = {}): Promise<boolean> {
  const currentState = host.stateStore.getState();
  const panelTarget = capturePanelTargetLease(currentState);
  const ephemeral = activeThreadState(currentState)?.lifetime?.kind === "ephemeral";
  const threadId = ephemeral ? null : panelThreadId(currentState);
  await host.cleanupForConnectionReset();
  if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
  if (ephemeral) options.beforeTargetReset?.();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  host.resetConnectionScope();
  host.stateStore.dispatch({ type: "connection/scoped-cleared" });
  host.setStatus(STATUS_RECONNECTING, { kind: "connecting" });

  await host.ensureConnected();
  if (!host.isConnected() || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
  if (!threadId) return true;
  try {
    const activation = await host.resumeThread(threadId);
    if (!activation || !(await activation.hydrate())) return false;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
    return activeThreadId(host.stateStore.getState()) === threadId;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}
