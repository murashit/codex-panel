import { type PendingRequestId, pendingRequestDerivedKeyPrefix } from "../../../../domain/pending-requests/model";

export function approvalDetailsDisclosureId(requestId: PendingRequestId): string {
  return `${pendingRequestDerivedKeyPrefix(requestId)}details`;
}
