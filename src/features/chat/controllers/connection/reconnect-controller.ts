import type { ChatAction, ChatStateStore } from "../../chat-state";

export interface ChatReconnectControllerHost {
  stateStore: ChatStateStore;
  activeThreadId: () => string | null;
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
    const threadId = this.host.activeThreadId();
    this.dispatch({ type: "ui/panel-set", panel: null });
    this.host.invalidateConnectionWork();
    this.host.invalidateResumeWork();
    this.host.clearDeferredDiagnostics();
    this.host.reconnect();
    this.host.clearClient();
    this.dispatch({ type: "turn/local-cleared" });
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

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }
}
