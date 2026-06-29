import { pendingRequestBlockStateFromRequestState } from "../../application/pending-requests/block";
import type { ChatRequestState } from "../../application/pending-requests/state";
import { pendingRequestsSignature } from "../../domain/pending-requests/signatures";
import { type PendingRequestBlockSnapshot, pendingRequestBlockSnapshotFromState } from "../../presentation/pending-requests/view-model";

export interface PendingRequestSurfaceProjection {
  readonly signature: string;
  readonly snapshot: PendingRequestBlockSnapshot;
}

export function pendingRequestSurfaceProjectionFromState(
  requests: ChatRequestState,
  approvalDetails: ReadonlySet<string>,
): PendingRequestSurfaceProjection | null {
  const signature = pendingRequestsSignature(
    requests.approvals,
    requests.pendingUserInputs,
    requests.pendingMcpElicitations,
    requests.userInputDrafts,
    requests.mcpElicitationDrafts,
  );
  if (!signature) return null;
  return {
    signature,
    snapshot: pendingRequestBlockSnapshotFromState(pendingRequestBlockStateFromRequestState(requests, approvalDetails)),
  };
}
