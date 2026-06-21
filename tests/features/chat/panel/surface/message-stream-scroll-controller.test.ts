import { describe, expect, it, vi } from "vitest";

import { createChatMessageScrollController } from "../../../../../src/features/chat/panel/surface/message-stream-scroll";
import type { MessageStreamScrollPort } from "../../../../../src/features/chat/ui/message-stream/virtualizer";

describe("createChatMessageScrollController", () => {
  it("ignores scroll commands while no message viewport is mounted", () => {
    const scrollController = createChatMessageScrollController();
    const dispatchScrollCommand = vi.fn<MessageStreamScrollPort["dispatchScrollCommand"]>();

    scrollController.showLatest();
    scrollController.scrollFromComposer({ direction: -1, amount: "page" });
    scrollController.mountScrollPort({ dispatchScrollCommand });

    expect(dispatchScrollCommand).not.toHaveBeenCalled();
  });

  it("dispatches commands to the mounted message viewport port", () => {
    const scrollController = createChatMessageScrollController();
    const dispatchScrollCommand = vi.fn<MessageStreamScrollPort["dispatchScrollCommand"]>();

    const unmount = scrollController.mountScrollPort({ dispatchScrollCommand });

    scrollController.scrollFromComposer({ direction: 1, amount: "text-lines" });
    scrollController.showLatest();

    expect(dispatchScrollCommand).toHaveBeenCalledTimes(2);
    expect(dispatchScrollCommand).toHaveBeenNthCalledWith(1, { kind: "scroll-by", amount: "text-lines", direction: 1 });
    expect(dispatchScrollCommand).toHaveBeenNthCalledWith(2, { kind: "show-latest" });

    unmount();
    scrollController.showLatest();
    expect(dispatchScrollCommand).toHaveBeenCalledTimes(2);
  });

  it("clears the mounted port on dispose", () => {
    const scrollController = createChatMessageScrollController();
    const dispatchScrollCommand = vi.fn<MessageStreamScrollPort["dispatchScrollCommand"]>();
    scrollController.mountScrollPort({ dispatchScrollCommand });

    scrollController.dispose();
    scrollController.showLatest();

    expect(dispatchScrollCommand).not.toHaveBeenCalled();
  });
});
