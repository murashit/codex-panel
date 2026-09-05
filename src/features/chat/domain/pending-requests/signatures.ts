import { hasPendingRequests, pendingRequestCountsFromQueues } from "./aggregate";
import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "./model";

export function pendingRequestFocusSignature(
  approvals: readonly PendingApproval[],
  inputs: readonly PendingUserInput[],
  mcpElicitations: readonly PendingMcpElicitation[],
): string {
  if (
    !hasPendingRequests(pendingRequestCountsFromQueues({ approvals, pendingUserInputs: inputs, pendingMcpElicitations: mcpElicitations }))
  ) {
    return "";
  }
  return JSON.stringify({
    approvals: approvals.map((approval) => ({ id: approval.requestId, kind: approval.kind })),
    inputs: inputs.map((input) => ({ id: input.requestId })),
    mcpElicitations: mcpElicitations.map((elicitation) => ({ id: elicitation.requestId, mode: elicitation.params.mode })),
  });
}
