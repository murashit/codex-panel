import { closePanelsAction } from "../../chat-state-actions";
import { canSwitchToThread } from "../../chat-state-selectors";
import type { ChatStateStore } from "../../chat-state";

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
    if (!canSwitchToThread(this.host.stateStore.getState(), threadId)) {
      this.host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }

    this.host.closeForThreadSelection();
    if (await this.host.focusThreadInOpenView(threadId)) return;
    await this.host.resumeThread(threadId);
  }

  async selectThreadFromToolbar(threadId: string): Promise<void> {
    if (!canSwitchToThread(this.host.stateStore.getState(), threadId)) return;

    this.host.stateStore.dispatch(closePanelsAction());
    await this.selectThread(threadId);
  }
}
