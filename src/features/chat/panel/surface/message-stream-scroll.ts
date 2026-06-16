import type { ComposerBoundaryScrollAction } from "../../application/composer/boundary-scroll";
import type { MessageStreamScrollIntent, MessageStreamVirtualizerHandle } from "../../ui/message-stream/virtualizer";

export interface ChatMessageScrollIntentState {
  consumeIntent(): MessageStreamScrollIntent;
  forceBottom(): void;
  followBottom(): void;
  preservePosition(): void;
}

export function createChatMessageScrollIntentState(): ChatMessageScrollIntentState {
  let nextIntent: MessageStreamScrollIntent = "auto";

  return {
    consumeIntent(): MessageStreamScrollIntent {
      const value = nextIntent;
      nextIntent = "auto";
      return value;
    },

    forceBottom(): void {
      nextIntent = "force-bottom";
    },

    followBottom(): void {
      nextIntent = "follow-bottom";
    },

    preservePosition(): void {
      nextIntent = "preserve";
    },
  };
}

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
