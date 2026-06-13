import type { ComposerBoundaryScrollAction } from "../../conversation/composer/boundary-scroll";
import type { MessageStreamVirtualizerHandle } from "../../ui/message-stream/virtualizer";

export class MessageStreamScrollBridge {
  private messageVirtualizer: MessageStreamVirtualizerHandle | null = null;

  registerVirtualizer = (virtualizer: MessageStreamVirtualizerHandle): (() => void) => {
    this.messageVirtualizer = virtualizer;
    return () => {
      if (this.messageVirtualizer === virtualizer) this.messageVirtualizer = null;
    };
  };

  dispose(): void {
    this.messageVirtualizer = null;
  }

  scrollFromComposer(action: ComposerBoundaryScrollAction): void {
    if (action.amount === "page") {
      this.messageVirtualizer?.scrollByPage(action.direction);
    } else {
      this.messageVirtualizer?.scrollByTextLines(action.direction);
    }
  }

  forceMessageStreamToBottom(): void {
    this.messageVirtualizer?.pinToBottom();
  }

  repinMessageStreamToBottomIfPinned(): void {
    this.messageVirtualizer?.repinToBottomIfPinned();
  }
}
