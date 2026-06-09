export function throwIfAbortSignalAborted(signal: AbortSignal | undefined, abortError: () => Error): void {
  if (signal?.aborted) throw abortError();
}

export function abortablePromise<T>(promise: Promise<T>, signal: AbortSignal | undefined, abortError: () => Error): Promise<T> {
  if (!signal) return promise;
  throwIfAbortSignalAborted(signal, abortError);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
