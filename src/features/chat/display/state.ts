import type { CommandExecutionStatus } from "../../../generated/app-server/v2/CommandExecutionStatus";
import type { CollabAgentStatus } from "../../../generated/app-server/v2/CollabAgentStatus";
import type { CollabAgentToolCallStatus } from "../../../generated/app-server/v2/CollabAgentToolCallStatus";
import type { DynamicToolCallStatus } from "../../../generated/app-server/v2/DynamicToolCallStatus";
import type { GuardianApprovalReviewStatus } from "../../../generated/app-server/v2/GuardianApprovalReviewStatus";
import type { McpToolCallStatus } from "../../../generated/app-server/v2/McpToolCallStatus";
import type { PatchApplyStatus } from "../../../generated/app-server/v2/PatchApplyStatus";
import type { TurnPlanStepStatus } from "../../../generated/app-server/v2/TurnPlanStepStatus";
import type { DisplayItem, ExecutionState } from "./types";

const COMMAND_RUNNING = ["inProgress"] as const satisfies readonly CommandExecutionStatus[];
const COMMAND_COMPLETED = ["completed"] as const satisfies readonly CommandExecutionStatus[];
const COMMAND_FAILED = ["failed", "declined"] as const satisfies readonly CommandExecutionStatus[];

const PATCH_RUNNING = ["inProgress"] as const satisfies readonly PatchApplyStatus[];
const PATCH_COMPLETED = ["completed"] as const satisfies readonly PatchApplyStatus[];
const PATCH_FAILED = ["failed", "declined"] as const satisfies readonly PatchApplyStatus[];

const STANDARD_TOOL_RUNNING = ["inProgress"] as const satisfies readonly (
  | McpToolCallStatus
  | DynamicToolCallStatus
  | CollabAgentToolCallStatus
)[];
const STANDARD_TOOL_COMPLETED = ["completed"] as const satisfies readonly (
  | McpToolCallStatus
  | DynamicToolCallStatus
  | CollabAgentToolCallStatus
)[];
const STANDARD_TOOL_FAILED = ["failed"] as const satisfies readonly (
  | McpToolCallStatus
  | DynamicToolCallStatus
  | CollabAgentToolCallStatus
)[];

const TASK_RUNNING = ["pending", "inProgress"] as const satisfies readonly TurnPlanStepStatus[];
const TASK_COMPLETED = ["completed"] as const satisfies readonly TurnPlanStepStatus[];

const AUTO_REVIEW_RUNNING = ["inProgress"] as const satisfies readonly GuardianApprovalReviewStatus[];
const AUTO_REVIEW_COMPLETED = ["approved"] as const satisfies readonly GuardianApprovalReviewStatus[];
const AUTO_REVIEW_FAILED = ["denied", "timedOut", "aborted"] as const satisfies readonly GuardianApprovalReviewStatus[];

const AGENT_RUNNING = ["pendingInit", "running"] as const satisfies readonly CollabAgentStatus[];
const AGENT_RUNNING_COMPAT = ["inProgress"] as const;
const AGENT_COMPLETED = ["completed", "shutdown"] as const satisfies readonly CollabAgentStatus[];
const AGENT_FAILED = ["interrupted", "errored", "notFound"] as const satisfies readonly CollabAgentStatus[];
const AGENT_FAILED_COMPAT = ["failed"] as const;

export function executionState(item: DisplayItem): ExecutionState {
  return item.executionState ?? null;
}

export function commandExecutionState(status: string, exitCode?: number): ExecutionState {
  if (typeof exitCode === "number" && exitCode !== 0) return "failed";
  if (oneOf(status, COMMAND_RUNNING)) return "running";
  if (oneOf(status, COMMAND_COMPLETED)) return "completed";
  if (oneOf(status, COMMAND_FAILED)) return "failed";
  if (typeof exitCode === "number") return "completed";
  return null;
}

export function patchApplyExecutionState(status: string): ExecutionState {
  if (oneOf(status, PATCH_RUNNING)) return "running";
  if (oneOf(status, PATCH_COMPLETED)) return "completed";
  if (oneOf(status, PATCH_FAILED)) return "failed";
  return null;
}

export function mcpToolCallExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

export function dynamicToolCallExecutionState(status: string, success?: boolean | null): ExecutionState {
  if (success === false) return "failed";
  const state = standardToolCallExecutionState(status);
  if (state) return state;
  return success === true ? "completed" : null;
}

export function imageGenerationExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

export function taskProgressExecutionState(status: string): ExecutionState {
  if (oneOf(status, TASK_RUNNING)) return "running";
  if (oneOf(status, TASK_COMPLETED)) return "completed";
  return null;
}

export function autoReviewExecutionState(status: string): ExecutionState {
  if (oneOf(status, AUTO_REVIEW_RUNNING)) return "running";
  if (oneOf(status, AUTO_REVIEW_COMPLETED)) return "completed";
  if (oneOf(status, AUTO_REVIEW_FAILED)) return "failed";
  return null;
}

export function collabAgentToolCallExecutionState(status: string): ExecutionState {
  return standardToolCallExecutionState(status);
}

export function collabAgentStateExecutionState(status: string): ExecutionState {
  if (oneOf(status, AGENT_RUNNING) || oneOf(status, AGENT_RUNNING_COMPAT)) return "running";
  if (oneOf(status, AGENT_COMPLETED)) return "completed";
  if (oneOf(status, AGENT_FAILED) || oneOf(status, AGENT_FAILED_COMPAT)) return "failed";
  return null;
}

function standardToolCallExecutionState(status: string): ExecutionState {
  if (oneOf(status, STANDARD_TOOL_RUNNING)) return "running";
  if (oneOf(status, STANDARD_TOOL_COMPLETED)) return "completed";
  if (oneOf(status, STANDARD_TOOL_FAILED)) return "failed";
  return null;
}

function oneOf<T extends string>(value: string, values: readonly T[]): value is T {
  return (values as readonly string[]).includes(value);
}
