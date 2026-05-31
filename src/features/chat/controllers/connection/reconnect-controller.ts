import type { ConnectionStatePort, PanelUiStatePort, ThreadLifecycleStatePort } from "../state-ports";

export interface ChatReconnectControllerHost {
  connectionState: ConnectionStatePort;
  panelState: PanelUiStatePort;
  threadState: ThreadLifecycleStatePort;
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

  async reconnectFromToolbar(): Promise<void> {
    const threadId = this.host.threadState.activeThreadId();
    this.host.panelState.closePanels();
    this.host.invalidateConnectionWork();
    this.host.invalidateResumeWork();
    this.host.clearDeferredDiagnostics();
    this.host.reconnect();
    this.host.clearClient();
    this.host.connectionState.clearLocalTurn();
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
