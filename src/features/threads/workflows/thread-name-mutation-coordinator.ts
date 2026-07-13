export interface ThreadNameMutationCoordinator {
  run<T>(threadId: string, operation: () => Promise<T>): Promise<T>;
}

export function createThreadNameMutationCoordinator(): ThreadNameMutationCoordinator {
  const pendingByThreadId = new Map<string, Promise<void>>();

  return {
    run(threadId, operation) {
      const previous = pendingByThreadId.get(threadId) ?? Promise.resolve();
      const result = previous.then(operation);
      const pending = result.then(
        () => undefined,
        () => undefined,
      );
      pendingByThreadId.set(threadId, pending);
      void pending.then(() => {
        if (pendingByThreadId.get(threadId) === pending) pendingByThreadId.delete(threadId);
      });
      return result;
    },
  };
}
