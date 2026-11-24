export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

export async function waitForAsyncWork(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await Promise.resolve();
    }
  }
  assertion();
}

/** All six delivery orders for three distinct events, as named it.each cases. */
export function eventOrders<const T extends string>(a: T, b: T, c: T) {
  return (
    [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ] as const
  ).map((order) => ({ order }));
}
