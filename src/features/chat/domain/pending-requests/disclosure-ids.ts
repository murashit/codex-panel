import type { PendingRequestId } from "./model";

export function approvalDetailsDisclosureId(requestId: PendingRequestId): string {
  return JSON.stringify(requestId);
}
