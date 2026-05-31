import type { MessageScrollIntent } from "../../ui/scroll";
import type { PanelUiStatePort } from "../state-ports";

export interface ChatMessageScrollControllerHost {
  state: PanelUiStatePort;
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
