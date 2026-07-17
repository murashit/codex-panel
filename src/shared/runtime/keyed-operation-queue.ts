export interface KeyedOperationQueue<K> {
  run<T>(key: K, operation: () => Promise<T>): Promise<T>;
}

export function createKeyedOperationQueue<K>(): KeyedOperationQueue<K> {
  const pendingByKey = new Map<K, Promise<void>>();
  return {
    run(key, operation) {
      const previous = pendingByKey.get(key) ?? Promise.resolve();
      const result = previous.then(operation);
      const pending = result.then(
        () => undefined,
        () => undefined,
      );
      pendingByKey.set(key, pending);
      void pending.then(() => {
        if (pendingByKey.get(key) === pending) pendingByKey.delete(key);
      });
      return result;
    },
  };
}
