import type { ChatStateStore } from "../../chat-state";
import type { MessageScrollIntent } from "../../ui/scroll";

export interface ChatMessageScrollControllerHost {
  stateStore: ChatStateStore;
  render: () => void;
}

export class ChatMessageScrollController {
  private nextIntent: MessageScrollIntent = "auto";

  constructor(private readonly host: ChatMessageScrollControllerHost) {}

  consumeIntent(): MessageScrollIntent {
    const value = this.nextIntent;
    this.nextIntent = "auto";
    return value;
  }

  forceBottom(): void {
    this.host.stateStore.dispatch({ type: "ui/messages-pinned-set", pinned: true });
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
