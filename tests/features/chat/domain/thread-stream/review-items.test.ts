import { describe, expect, it } from "vitest";
import { threadStreamIsAutoReviewDecision } from "../../../../../src/features/chat/domain/thread-stream/review-items";

describe("review items", () => {
  it("recognizes auto-review decisions only for permission result kinds and exact provenance", () => {
    const provenances = [
      { source: "panel", channel: "notice", reason: "parsedAutoReview", sourceId: "review" },
      { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: "review" },
    ] as const;
    for (const provenance of provenances) {
      expect(threadStreamIsAutoReviewDecision({ id: "review", kind: "reviewResult", role: "tool", text: "approved", provenance })).toBe(
        true,
      );
      expect(
        threadStreamIsAutoReviewDecision({
          id: "approval",
          kind: "approvalResult",
          role: "tool",
          text: "approved",
          approval: { status: "allowed", scope: "turn", request: "Approval", auditFacts: [] },
          provenance,
        }),
      ).toBe(true);
      expect(
        threadStreamIsAutoReviewDecision({
          id: "user",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "approved",
          turnId: "turn",
          provenance,
        }),
      ).toBe(false);
    }
    expect(
      threadStreamIsAutoReviewDecision({
        id: "review",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved",
        provenance: { source: "panel", channel: "notice", reason: "reviewMessage", sourceId: "review" },
      }),
    ).toBe(false);
  });
});
