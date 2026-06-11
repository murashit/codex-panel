import { describe, expect, it } from "vitest";

import { ChatMessageScrollIntentController } from "../../../../src/features/chat/panel/message-scroll-intent-controller";

describe("ChatMessageScrollIntentController", () => {
  it("consumes one-shot scroll intents", () => {
    const controller = new ChatMessageScrollIntentController();

    controller.preservePosition();

    expect(controller.consumeIntent()).toBe("preserve");
    expect(controller.consumeIntent()).toBe("auto");
  });

  it("emits a one-shot force-bottom intent", () => {
    const controller = new ChatMessageScrollIntentController();

    controller.forceBottom();

    expect(controller.consumeIntent()).toBe("force-bottom");
  });

  it("uses the latest scroll intent before consumption", () => {
    const controller = new ChatMessageScrollIntentController();

    controller.preservePosition();
    controller.followBottom();
    controller.forceBottom();

    expect(controller.consumeIntent()).toBe("force-bottom");
    expect(controller.consumeIntent()).toBe("auto");
  });
});
