export interface ThreadGoalCoordinator {
  runMutation<T>(threadId: string, operation: () => Promise<T>): Promise<T>;
  captureReadRevision(threadId: string): number;
  readRevisionIsCurrent(threadId: string, revision: number): boolean;
  markAuthoritativeObservation(threadId: string): void;
}
