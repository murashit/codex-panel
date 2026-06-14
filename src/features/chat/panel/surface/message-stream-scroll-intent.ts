import type { MessageStreamScrollIntent } from "../../ui/message-stream/virtualizer";

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
