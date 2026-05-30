export async function waitForAsyncWork(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  assertion();
  if (lastError instanceof Error) throw lastError;
  throw new Error("Timed out waiting for async test work.");
}
