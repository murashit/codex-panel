import type { ThreadGoalCoordinator } from "../../../domain/threads/goal-coordination";
import { createKeyedOperationCoordinator } from "../../../shared/runtime/keyed-operation-coordinator";

export function createThreadGoalCoordinator(): ThreadGoalCoordinator {
  const readRevisions = new Map<string, number>();
  const goalMutations = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
  return {
    runMutation: (threadId, operation) => goalMutations.run(threadId, operation),
    captureReadRevision: (threadId) => readRevisions.get(threadId) ?? 0,
    readRevisionIsCurrent: (threadId, revision) => (readRevisions.get(threadId) ?? 0) === revision,
    markAuthoritativeObservation: (threadId) => {
      readRevisions.set(threadId, (readRevisions.get(threadId) ?? 0) + 1);
    },
  };
}
