import type { DisplayItem, ExecutionState } from "./types";

export function executionState(item: DisplayItem): ExecutionState {
  if (item.state) return item.state;
  const exitCode = item.kind === "command" ? item.exitCode : undefined;
  const status =
    item.kind === "command" ||
    item.kind === "fileChange" ||
    item.kind === "tool" ||
    item.kind === "taskProgress" ||
    item.kind === "agent" ||
    item.kind === "hook" ||
    item.kind === "reasoning"
      ? item.status
      : undefined;
  return classifyExecutionState({ exitCode, status });
}

export function classifyExecutionState(input: { exitCode?: number; status?: unknown }): ExecutionState {
  if (typeof input.exitCode === "number" && input.exitCode !== 0) return "failed";

  const statusText = [input.status]
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();

  if (/(fail|error|errored|notfound|not_found|missing|denied|declin|cancel|reject|aborted)/.test(statusText)) return "failed";
  if (/(running|in[_ -]?progress|queued|pending|started)/.test(statusText)) return "running";
  if (/(completed|complete|success|succeeded|approved|allowed|applied|finished|done)/.test(statusText)) return "completed";
  if (typeof input.exitCode === "number" && input.exitCode === 0) return "completed";
  return null;
}

export function executionStateLabel(state: Exclude<ExecutionState, null>): string {
  if (state === "running") return "Running";
  if (state === "failed") return "Failed";
  return "Done";
}
