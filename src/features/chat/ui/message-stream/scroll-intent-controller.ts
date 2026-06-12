import type { MessageStreamScrollIntent } from "./virtualizer";

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

  followBottom(): void {
    this.nextIntent = "follow-bottom";
  }

  preservePosition(): void {
    this.nextIntent = "preserve";
  }
}
