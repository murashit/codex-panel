import type { PendingRequestId } from "../../../../domain/interaction-requests/model";
import { pendingRequestDerivedKeyPrefix } from "./drafts";

export function approvalDetailsDisclosureId(requestId: PendingRequestId): string {
  return `${pendingRequestDerivedKeyPrefix(requestId)}details`;
}
