import { pendingRequestDerivedKeyPrefix, type PendingRequestId } from "../../../../domain/pending-requests/model";

export function approvalDetailsDisclosureId(requestId: PendingRequestId): string {
  return `${pendingRequestDerivedKeyPrefix(requestId)}details`;
}
