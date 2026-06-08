import type { MessageStreamScrollIntent } from "../ui/message-virtualizer";

export class ChatMessageScrollIntentController {
  private nextIntent: MessageStreamScrollIntent = "auto";

  consumeIntent(): MessageStreamScrollIntent {
    const value = this.nextIntent;
    this.nextIntent = "auto";
    return value;
  }

  forceBottom(): void {
    this.nextIntent = "force-bottom";
  }

  preservePosition(): void {
    this.nextIntent = "preserve";
  }
}
