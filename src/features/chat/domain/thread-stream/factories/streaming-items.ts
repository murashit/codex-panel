import { RUNNING_EXECUTION_STATE, type ThreadStreamItem, type ThreadStreamItemKind } from "../items";

export const STREAMED_COMMAND_RUNNING_TEXT = "Command running";
export const STREAMED_MCP_PROGRESS_LABEL = "mcp progress";
const UNKNOWN_STREAMED_COMMAND_CWD = "(unknown)";

export function streamedTextThreadStreamItem(params: {
  id: string;
  turnId: string;
  label: string;
  delta: string;
  kind: Extract<ThreadStreamItemKind, "tool" | "hook" | "reasoning">;
}): ThreadStreamItem {
  return {
    id: params.id,
    kind: params.kind,
    role: "tool",
    text: `${params.label}: ${params.delta}`,
    turnId: params.turnId,
    sourceItemId: params.id,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: params.id },
  };
}

export function streamedToolOutputThreadStreamItem(params: {
  id: string;
  turnId: string;
  output: string;
  fallbackLabel: string;
}): ThreadStreamItem {
  return {
    id: params.id,
    kind: "tool",
    role: "tool",
    toolName: params.fallbackLabel,
    turnId: params.turnId,
    sourceItemId: params.id,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: params.id },
    output: params.output,
  };
}

export function streamedItemOutputThreadStreamItem(params: {
  id: string;
  turnId: string;
  output: string;
  kind: "command" | "fileChange";
  fallbackText: string;
}): ThreadStreamItem {
  return {
    id: params.id,
    kind: params.kind,
    role: "tool",
    turnId: params.turnId,
    sourceItemId: params.id,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: params.id },
    output: params.output,
    ...(params.kind === "fileChange"
      ? {
          status: "inProgress",
          changes: [],
          executionState: RUNNING_EXECUTION_STATE,
        }
      : {
          commandAction: "command",
          commandTarget: { kind: "command", commandLine: params.fallbackText },
          command: params.fallbackText,
          cwd: UNKNOWN_STREAMED_COMMAND_CWD,
          status: "running",
          executionState: RUNNING_EXECUTION_STATE,
        }),
  } as ThreadStreamItem;
}
