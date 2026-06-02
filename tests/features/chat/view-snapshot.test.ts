import { describe, expect, it } from "vitest";

import { latestProposedPlanItem, openPanelTurnLifecycle, parseRestoredThreadState } from "../../../src/features/chat/view-snapshot";

describe("chat view snapshots", () => {
  it("projects open panel turn lifecycle without exposing full chat state", () => {
    expect(openPanelTurnLifecycle({ kind: "idle" })).toEqual({ kind: "idle" });
    expect(openPanelTurnLifecycle({ kind: "starting", pendingTurnStart: { anchorItemId: "local", promptSubmitHookItemIds: [] } })).toEqual({
      kind: "starting",
    });
    expect(openPanelTurnLifecycle({ kind: "running", turnId: "turn" })).toEqual({ kind: "running", turnId: "turn" });
  });

  it("finds the latest proposed plan item", () => {
    expect(
      latestProposedPlanItem([
        { id: "first", kind: "message", role: "assistant", text: "plan", proposedPlan: true },
        { id: "user", kind: "message", role: "user", text: "ok" },
        { id: "latest", kind: "message", role: "assistant", text: "plan", proposedPlan: true },
      ])?.id,
    ).toBe("latest");
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
