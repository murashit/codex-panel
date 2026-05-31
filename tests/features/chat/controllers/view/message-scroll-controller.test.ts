import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import { createPanelUiStatePort } from "../../../../../src/features/chat/controllers/state-ports";
import { ChatMessageScrollController } from "../../../../../src/features/chat/controllers/view/message-scroll-controller";

describe("ChatMessageScrollController", () => {
  it("consumes one-shot scroll intents", () => {
    const controller = new ChatMessageScrollController({
      state: createPanelUiStatePort(createChatStateStore(createChatState())),
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
    const controller = new ChatMessageScrollController({ state: createPanelUiStatePort(stateStore), render });

    controller.scrollToBottomOnFocus();

    expect(stateStore.getState().messagesPinnedToBottom).toBe(true);
    expect(controller.consumeIntent()).toBe("force-bottom");
    expect(render).toHaveBeenCalledOnce();
  });
});
