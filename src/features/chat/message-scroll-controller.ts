import type { ChatStateStore } from "./chat-state";
import type { ChatMessageScrollIntent } from "./chat-message-renderer";

export interface ChatMessageScrollControllerHost {
  stateStore: ChatStateStore;
  render: () => void;
}

export class ChatMessageScrollController {
  private nextIntent: ChatMessageScrollIntent = "auto";

  constructor(private readonly host: ChatMessageScrollControllerHost) {}

  consumeIntent(): ChatMessageScrollIntent {
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
