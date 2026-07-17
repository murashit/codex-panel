import { createKeyedOperationQueue } from "../../../shared/runtime/keyed-operation-queue";

export interface ThreadNameMutationCoordinator {
  run<T>(threadId: string, operation: () => Promise<T>): Promise<T>;
}

export function createThreadNameMutationCoordinator(): ThreadNameMutationCoordinator {
  return createKeyedOperationQueue();
}
