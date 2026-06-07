import type { MessageStreamScrollIntent } from "../../ui/message-virtualizer";
import type { PanelUiStatePort } from "../state-ports";

export interface ChatMessageScrollIntentControllerHost {
  state: PanelUiStatePort;
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
    this.host.state.pinMessagesToBottom();
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
