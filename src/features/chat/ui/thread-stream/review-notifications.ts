import type { ReviewResultThreadStreamItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import { isTerminalTurnErrorItem } from "../../domain/thread-stream/turn-error-notices";

export function reviewNotificationPresentation(items: readonly ThreadStreamItem[]): {
  notificationByResultId: ReadonlyMap<string, string>;
  foldedNotificationIds: ReadonlySet<string>;
} {
  const candidates = new Map<string, { results: ReviewResultThreadStreamItem[]; notifications: ReviewResultThreadStreamItem[] }>();
  for (const item of items) {
    if (item.kind !== "reviewResult" || !item.turnId) continue;
    // Only the bare tooManyDenials terminal error is represented as a review result.
    const terminal = isTerminalTurnErrorItem(item);
    const result = item.reviewKind === "automaticResult" || terminal;
    const notification =
      item.provenance?.source === "panel" &&
      item.provenance.channel === "notice" &&
      (item.provenance.reason === "parsedAutoReview" || item.provenance.reason === "reviewMessage");
    if (!result && !notification) continue;
    const message = result ? (terminal ? item.text : item.review?.assessmentMessage) : (item.review?.originalMessage ?? item.text);
    if (message === undefined) continue;
    const key = JSON.stringify([item.turnId, message]);
    const group = candidates.get(key) ?? { results: [], notifications: [] };
    (result ? group.results : group.notifications).push(item);
    candidates.set(key, group);
  }

  const notificationByResultId = new Map<string, string>();
  const foldedNotificationIds = new Set<string>();
  for (const { results, notifications } of candidates.values()) {
    // Matching content is not event identity. Keep competing/repeated observations separate.
    if (results.length !== 1 || notifications.length !== 1) continue;
    const result = results[0];
    const notification = notifications[0];
    if (!result || !notification) continue;
    notificationByResultId.set(result.id, notification.review?.originalMessage ?? notification.text);
    foldedNotificationIds.add(notification.id);
  }
  return { notificationByResultId, foldedNotificationIds };
}
