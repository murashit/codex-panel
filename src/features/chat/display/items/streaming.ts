import type { FileUpdateChange } from "../../../../app-server/protocol/turn";
import type { MessageStreamItem, MessageStreamItemKind } from "../../message-stream/items";
import { normalizeFileChanges } from "../../message-stream/from-turn-items";

const STREAMED_TOOL_DETAILS_TEXT = "details";
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
    text: STREAMED_TOOL_DETAILS_TEXT,
    toolLabel: params.fallbackLabel,
    turnId: params.turnId,
    sourceItemId: params.id,
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
    text: params.fallbackText,
    turnId: params.turnId,
    sourceItemId: params.id,
    output: params.output,
    ...(params.kind === "fileChange"
      ? {
          status: "inProgress",
          changes: [],
          executionState: "running",
        }
      : {
          command: params.fallbackText,
          cwd: UNKNOWN_STREAMED_COMMAND_CWD,
          status: "running",
          executionState: "running",
        }),
  } as MessageStreamItem;
}

export function streamingFileChangeMessageStreamItem(
  itemId: string,
  turnId: string,
  changes: FileUpdateChange[],
  status: string,
): MessageStreamItem {
  return {
    id: itemId,
    kind: "fileChange",
    role: "tool",
    text: `File change ${status}`,
    turnId,
    sourceItemId: itemId,
    status,
    changes: normalizeFileChanges(changes),
  };
}
