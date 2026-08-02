export class StaleExecutionRuntimeError extends Error {
  constructor() {
    super("Codex execution runtime was disposed while work was in progress.");
    this.name = "StaleExecutionRuntimeError";
  }
}
