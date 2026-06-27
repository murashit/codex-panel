import { describe, expect, it } from "vitest";

import { openPanelTurnLifecycle } from "../../../../src/features/chat/host/workspace-panel-snapshot";

describe("chat workspace panel snapshots", () => {
  it("projects open panel turn lifecycle without exposing full chat state", () => {
    expect(openPanelTurnLifecycle({ kind: "idle" })).toEqual({ kind: "idle" });
    expect(openPanelTurnLifecycle({ kind: "starting", pendingTurnStart: { anchorItemId: "local", promptSubmitHookItemIds: [] } })).toEqual({
      kind: "starting",
    });
    expect(openPanelTurnLifecycle({ kind: "running", turnId: "turn" })).toEqual({ kind: "running", turnId: "turn" });
  });
});
