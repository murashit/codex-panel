import { describe, expect, it } from "vitest";

import { createChatMessageScrollIntentState } from "../../../../../src/features/chat/ui/message-stream/scroll-intent-state";

describe("createChatMessageScrollIntentState", () => {
  it("consumes one-shot scroll intents", () => {
    const scrollIntent = createChatMessageScrollIntentState();

    scrollIntent.preservePosition();

    expect(scrollIntent.consumeIntent()).toBe("preserve");
    expect(scrollIntent.consumeIntent()).toBe("auto");
  });

  it("emits a one-shot force-bottom intent", () => {
    const scrollIntent = createChatMessageScrollIntentState();

    scrollIntent.forceBottom();

    expect(scrollIntent.consumeIntent()).toBe("force-bottom");
  });

  it("uses the latest scroll intent before consumption", () => {
    const scrollIntent = createChatMessageScrollIntentState();

    scrollIntent.preservePosition();
    scrollIntent.followBottom();
    scrollIntent.forceBottom();

    expect(scrollIntent.consumeIntent()).toBe("force-bottom");
    expect(scrollIntent.consumeIntent()).toBe("auto");
  });
});
