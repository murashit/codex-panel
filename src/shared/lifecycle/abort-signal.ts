export function listenAbortSignal(signal: AbortSignal, listener: () => void): () => void {
  signal.addEventListener("abort", listener, { once: true });
  return () => {
    signal.removeEventListener("abort", listener);
  };
}
