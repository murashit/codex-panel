export class StaleExecutionRuntimeError extends Error {
  constructor() {
    super("Codex execution runtime was disposed while work was in progress.");
    this.name = "StaleExecutionRuntimeError";
  }
}

export function isStaleExecutionRuntimeError(error: unknown): error is StaleExecutionRuntimeError {
  return error instanceof StaleExecutionRuntimeError;
}
