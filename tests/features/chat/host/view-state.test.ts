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
});
