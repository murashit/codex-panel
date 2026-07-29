import { createKeyedOperationCoordinator, type KeyedOperationCoordinator } from "../../../../shared/runtime/keyed-operation-coordinator";

export interface ThreadGoalCoordinator {
  readonly goalMutations: KeyedOperationCoordinator<string>;
  captureReadRevision(threadId: string): number;
  readRevisionIsCurrent(threadId: string, revision: number): boolean;
  markAuthoritativeObservation(threadId: string): void;
}

export function createThreadGoalCoordinator(): ThreadGoalCoordinator {
  const readRevisions = new Map<string, number>();
  const goalMutations = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
  return {
    goalMutations,
    captureReadRevision: (threadId) => readRevisions.get(threadId) ?? 0,
    readRevisionIsCurrent: (threadId, revision) => (readRevisions.get(threadId) ?? 0) === revision,
    markAuthoritativeObservation: (threadId) => {
      readRevisions.set(threadId, (readRevisions.get(threadId) ?? 0) + 1);
    },
  };
}
