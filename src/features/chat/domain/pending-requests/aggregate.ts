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

export function pendingRequestCountsFromQueues(source: PendingRequestQueueSource): PendingRequestCounts {
  const approvals = source.approvals.length;
  const userInputs = source.pendingUserInputs.length;
  const mcpElicitations = source.pendingMcpElicitations.length;
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
