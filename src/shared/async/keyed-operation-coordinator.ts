export interface KeyedOperationCoordinator<K> {
  run<T>(key: K, operation: () => Promise<T>): Promise<T>;
}

export function createKeyedOperationCoordinator<K>(): KeyedOperationCoordinator<K> {
  const pendingByKey = new Map<K, Promise<void>>();
  return {
    async run(key, operation) {
      const previous = pendingByKey.get(key) ?? Promise.resolve();
      const result = previous.then(operation);
      const pending = result.then(
        () => undefined,
        () => undefined,
      );
      pendingByKey.set(key, pending);
      try {
        return await result;
      } finally {
        if (pendingByKey.get(key) === pending) pendingByKey.delete(key);
      }
    },
  };
}
