import type { ThreadStreamItem } from "./items";

export function threadStreamIsAutoReviewDecision(item: ThreadStreamItem): boolean {
  return item.kind === "reviewResult" && item.reviewKind === "automaticResult";
}
