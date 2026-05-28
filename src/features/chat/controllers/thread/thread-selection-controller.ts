import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "../../chat-state";

export interface ThreadSelectionControllerHost {
  stateStore: ChatStateStore;
  closeForThreadSelection: () => void;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export class ThreadSelectionController {
  constructor(private readonly host: ThreadSelectionControllerHost) {}

  async selectThread(threadId: string): Promise<void> {
    if (chatTurnBusy(this.state) && threadId !== this.state.activeThreadId) {
      this.host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }

    this.host.closeForThreadSelection();
    if (await this.host.focusThreadInOpenView(threadId)) return;
    await this.host.resumeThread(threadId);
  }

  async selectThreadFromToolbar(threadId: string): Promise<void> {
    if (chatTurnBusy(this.state) && threadId !== this.state.activeThreadId) return;

    this.dispatch({ type: "ui/panel-set", panel: null });
    await this.selectThread(threadId);
  }

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }
}
