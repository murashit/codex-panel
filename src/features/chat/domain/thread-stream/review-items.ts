import type { ThreadStreamItem } from "./items";

export function threadStreamIsAutoReviewDecision(item: ThreadStreamItem): boolean {
  if (item.kind !== "reviewResult" && item.kind !== "approvalResult") return false;
  const { provenance } = item;
  if (provenance?.source === "appServer" && provenance.channel === "notification") return provenance.event === "autoReview";
  if (provenance?.source === "panel" && provenance.channel === "notice") return provenance.reason === "parsedAutoReview";
  return false;
}
