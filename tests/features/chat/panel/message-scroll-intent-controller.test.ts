import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../src/features/chat/chat-state";
import { ChatMessageScrollIntentController } from "../../../../src/features/chat/panel/message-scroll-intent-controller";

describe("ChatMessageScrollIntentController", () => {
  it("consumes one-shot scroll intents", () => {
    const controller = new ChatMessageScrollIntentController({
      stateStore: createChatStateStore(createChatState()),
      render: vi.fn(),
    });

    controller.preservePosition();

    expect(controller.consumeIntent()).toBe("preserve");
    expect(controller.consumeIntent()).toBe("auto");
  });

  it("pins messages and renders when focusing the view", () => {
    const stateStore = createChatStateStore(createChatState());
    stateStore.dispatch({ type: "ui/messages-pinned-set", pinned: false });
    const render = vi.fn();
    const controller = new ChatMessageScrollIntentController({ stateStore, render });

    controller.scrollToBottomOnFocus();

    expect(stateStore.getState().ui.messagesPinnedToBottom).toBe(true);
    expect(controller.consumeIntent()).toBe("force-bottom");
    expect(render).toHaveBeenCalledOnce();
  });
});
