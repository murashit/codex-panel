import { describe, expect, it } from "vitest";

import { openPanelTurnLifecycle, parseRestoredThreadState } from "../../../../src/features/chat/panel/snapshot";

describe("chat view snapshots", () => {
  it("projects open panel turn lifecycle without exposing full chat state", () => {
    expect(openPanelTurnLifecycle({ kind: "idle" })).toEqual({ kind: "idle" });
    expect(openPanelTurnLifecycle({ kind: "starting", pendingTurnStart: { anchorItemId: "local", promptSubmitHookItemIds: [] } })).toEqual({
      kind: "starting",
    });
    expect(openPanelTurnLifecycle({ kind: "running", turnId: "turn" })).toEqual({ kind: "running", turnId: "turn" });
  });

  it("parses restored thread view state defensively", () => {
    expect(parseRestoredThreadState({ threadId: "thread", threadTitle: "Title" })).toEqual({
      threadId: "thread",
      title: "Title",
      explicitName: null,
    });
    expect(parseRestoredThreadState({ threadId: "" })).toBeNull();
    expect(parseRestoredThreadState(null)).toBeNull();
  });
});
