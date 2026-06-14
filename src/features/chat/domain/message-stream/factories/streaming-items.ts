import type { MessageStreamItem, MessageStreamItemKind } from "../items";

export const STREAMED_COMMAND_RUNNING_TEXT = "Command running";
export const STREAMED_FILE_CHANGE_IN_PROGRESS_TEXT = "File change inProgress";
export const STREAMED_MCP_PROGRESS_LABEL = "mcp progress";
const UNKNOWN_STREAMED_COMMAND_CWD = "(unknown)";

export function streamedTextMessageStreamItem(params: {
  id: string;
  turnId: string;
  label: string;
  delta: string;
  kind: Extract<MessageStreamItemKind, "tool" | "hook" | "reasoning">;
}): MessageStreamItem {
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

export function streamedToolOutputMessageStreamItem(params: {
  id: string;
  turnId: string;
  output: string;
  fallbackLabel: string;
}): MessageStreamItem {
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

export function streamedItemOutputMessageStreamItem(params: {
  id: string;
  turnId: string;
  output: string;
  kind: "command" | "fileChange";
  fallbackText: string;
}): MessageStreamItem {
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
          executionState: "running",
        }
      : {
          commandAction: "command",
          commandTarget: { kind: "command", commandLine: params.fallbackText },
          command: params.fallbackText,
          cwd: UNKNOWN_STREAMED_COMMAND_CWD,
          status: "running",
          executionState: "running",
        }),
  } as MessageStreamItem;
}
