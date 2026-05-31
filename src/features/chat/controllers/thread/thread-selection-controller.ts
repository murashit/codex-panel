import type { PanelUiStatePort, ThreadLifecycleStatePort } from "../state-ports";

export interface ThreadSelectionControllerHost {
  panelState: PanelUiStatePort;
  threadState: ThreadLifecycleStatePort;
  closeForThreadSelection: () => void;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  resumeThread: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
}

export class ThreadSelectionController {
  constructor(private readonly host: ThreadSelectionControllerHost) {}

  async selectThread(threadId: string): Promise<void> {
    if (!this.host.threadState.canSwitchToThread(threadId)) {
      this.host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
      return;
    }

    this.host.closeForThreadSelection();
    if (await this.host.focusThreadInOpenView(threadId)) return;
    await this.host.resumeThread(threadId);
  }

  async selectThreadFromToolbar(threadId: string): Promise<void> {
    if (!this.host.threadState.canSwitchToThread(threadId)) return;

    this.host.panelState.closePanels();
    await this.selectThread(threadId);
  }
}
