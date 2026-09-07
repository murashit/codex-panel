import { describe, expect, it } from "vitest";
import { threadStreamIsAutoReviewDecision } from "../../../../../src/features/chat/domain/thread-stream/review-items";

describe("review items", () => {
  it("groups automatic results by meaning rather than their display text", () => {
    for (const reviewKind of ["automaticResult", "automaticWarning", "message"] as const) {
      expect(
        threadStreamIsAutoReviewDecision({ id: "review", kind: "reviewResult", reviewKind, role: "tool", text: "Approval checked" }),
      ).toBe(reviewKind === "automaticResult");
    }
    expect(
      threadStreamIsAutoReviewDecision({
        id: "approval",
        kind: "approvalResult",
        role: "tool",
        text: "Auto-review approved",
        approval: { status: "allowed", scope: "turn", request: "Approval", auditFacts: [] },
      }),
    ).toBe(false);
  });
});
