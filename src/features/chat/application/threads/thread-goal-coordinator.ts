import { createKeyedOperationQueue, type KeyedOperationQueue } from "../../../../shared/runtime/keyed-operation-queue";

export interface ThreadGoalCoordinator {
  readonly goalMutations: KeyedOperationQueue<string>;
  captureReadRevision(threadId: string): number;
  readRevisionIsCurrent(threadId: string, revision: number): boolean;
  markAuthoritativeObservation(threadId: string): void;
}

export function createThreadGoalCoordinator(): ThreadGoalCoordinator {
  const readRevisions = new Map<string, number>();
  const goalMutations = createKeyedOperationQueue<string>();
  return {
    goalMutations,
    captureReadRevision: (threadId) => readRevisions.get(threadId) ?? 0,
    readRevisionIsCurrent: (threadId, revision) => (readRevisions.get(threadId) ?? 0) === revision,
    markAuthoritativeObservation: (threadId) => {
      readRevisions.set(threadId, (readRevisions.get(threadId) ?? 0) + 1);
    },
  };
}
