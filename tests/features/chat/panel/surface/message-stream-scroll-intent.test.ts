import { describe, expect, it } from "vitest";

import { createChatMessageScrollIntentState } from "../../../../../src/features/chat/panel/surface/message-stream-scroll";

describe("createChatMessageScrollIntentState", () => {
  it("starts with automatic scrolling", () => {
    const scrollIntent = createChatMessageScrollIntentState();

    expect(scrollIntent.consumeIntent()).toBe("auto");
    expect(scrollIntent.consumeIntent()).toBe("auto");
  });

  it("consumes force bottom intent once", () => {
    const scrollIntent = createChatMessageScrollIntentState();

    scrollIntent.forceBottom();

    expect(scrollIntent.consumeIntent()).toBe("force-bottom");
    expect(scrollIntent.consumeIntent()).toBe("auto");
  });

  it("keeps the latest requested intent", () => {
    const scrollIntent = createChatMessageScrollIntentState();

    scrollIntent.followBottom();
    scrollIntent.preservePosition();

    expect(scrollIntent.consumeIntent()).toBe("preserve");
  });
});
