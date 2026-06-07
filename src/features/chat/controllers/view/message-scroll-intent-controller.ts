import type { MessageStreamScrollIntent } from "../../ui/message-virtualizer";
import { pinMessagesToBottomAction } from "../../chat-state-actions";
import type { ChatStateStore } from "../../chat-state";

export interface ChatMessageScrollIntentControllerHost {
  stateStore: ChatStateStore;
  render: () => void;
}

export class ChatMessageScrollIntentController {
  private nextIntent: MessageStreamScrollIntent = "auto";

  constructor(private readonly host: ChatMessageScrollIntentControllerHost) {}

  consumeIntent(): MessageStreamScrollIntent {
    const value = this.nextIntent;
    this.nextIntent = "auto";
    return value;
  }

  forceBottom(): void {
    this.host.stateStore.dispatch(pinMessagesToBottomAction());
    this.nextIntent = "force-bottom";
  }

  preservePosition(): void {
    this.nextIntent = "preserve";
  }

  scrollToBottomOnFocus(): void {
    this.forceBottom();
    this.host.render();
  }
}
