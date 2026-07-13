import { describe, expect, it } from "vitest";

import { parseChatPanelViewState } from "../../../../src/features/chat/host/view-state";

describe("parseChatPanelViewState", () => {
  it("parses persistent thread state defensively", () => {
    expect(parseChatPanelViewState({ threadId: "thread", threadTitle: "Title" })).toEqual({
      kind: "thread",
      threadId: "thread",
      fallbackTitle: "Title",
    });
    expect(parseChatPanelViewState({ threadId: "" })).toEqual({ kind: "empty" });
    expect(parseChatPanelViewState(null)).toEqual({ kind: "empty" });
  });

  it("treats persisted ephemeral side chats as discarded", () => {
    expect(parseChatPanelViewState({ version: 2, ephemeralSource: { threadId: "source", title: "Source" } })).toEqual({
      kind: "empty",
    });
  });
});
