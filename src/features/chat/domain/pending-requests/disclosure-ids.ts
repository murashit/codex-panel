import { pendingRequestDerivedKeyPrefix } from "./drafts";
import type { PendingRequestId } from "./model";

export function approvalDetailsDisclosureId(requestId: PendingRequestId): string {
  return `${pendingRequestDerivedKeyPrefix(requestId)}details`;
}
