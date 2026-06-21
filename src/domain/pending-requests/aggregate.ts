export interface PendingRequestCounts {
  readonly approvals: number;
  readonly userInputs: number;
  readonly mcpElicitations: number;
  readonly actionable: number;
}

interface PendingRequestQueueSource {
  readonly approvals: readonly unknown[];
  readonly pendingUserInputs: readonly unknown[];
  readonly pendingMcpElicitations: readonly unknown[];
}

interface PendingRequestCountSource {
  readonly pendingApprovals: number;
  readonly pendingUserInputs: number;
  readonly pendingMcpElicitations: number;
}

export function pendingRequestCountsFromQueues(source: PendingRequestQueueSource): PendingRequestCounts {
  return pendingRequestCounts({
    pendingApprovals: source.approvals.length,
    pendingUserInputs: source.pendingUserInputs.length,
    pendingMcpElicitations: source.pendingMcpElicitations.length,
  });
}

export function pendingRequestCounts(source: PendingRequestCountSource): PendingRequestCounts {
  const approvals = source.pendingApprovals;
  const userInputs = source.pendingUserInputs;
  const mcpElicitations = source.pendingMcpElicitations;
  return {
    approvals,
    userInputs,
    mcpElicitations,
    actionable: approvals + userInputs + mcpElicitations,
  };
}

export function hasPendingRequests(counts: PendingRequestCounts): boolean {
  return counts.actionable > 0;
}
