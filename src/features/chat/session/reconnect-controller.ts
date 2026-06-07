import { clearLocalTurnAction, closePanelsAction } from "../chat-state-actions";
import { activeThreadId } from "../chat-state-selectors";
import type { ChatStateStore } from "../chat-state";

export interface ChatReconnectControllerHost {
  stateStore: ChatStateStore;
  invalidateConnectionWork: () => void;
  invalidateResumeWork: () => void;
  clearDeferredDiagnostics: () => void;
  reconnect: () => void;
  clearClient: () => void;
  setStatus: (status: string) => void;
  render: () => void;
  ensureConnected: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export class ChatReconnectController {
  constructor(private readonly host: ChatReconnectControllerHost) {}

  async reconnectPanel(): Promise<void> {
    const threadId = activeThreadId(this.host.stateStore.getState());
    this.host.stateStore.dispatch(closePanelsAction());
    this.host.invalidateConnectionWork();
    this.host.invalidateResumeWork();
    this.host.clearDeferredDiagnostics();
    this.host.reconnect();
    this.host.clearClient();
    this.host.stateStore.dispatch(clearLocalTurnAction());
    this.host.setStatus("Reconnecting...");
    this.host.render();

    await this.host.ensureConnected();
    if (!threadId) return;
    try {
      await this.host.resumeThread(threadId);
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
  }
}
