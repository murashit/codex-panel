import type { FileUpdateChange } from "../../../../app-server/protocol/turn";
import type { DisplayItem, DisplayKind } from "../types";
import { normalizeFileChanges } from "../turn-items";

const STREAMED_TOOL_DETAILS_TEXT = "details";
export const STREAMED_COMMAND_RUNNING_TEXT = "Command running";
export const STREAMED_FILE_CHANGE_IN_PROGRESS_TEXT = "File change inProgress";
export const STREAMED_MCP_PROGRESS_LABEL = "mcp progress";
const UNKNOWN_STREAMED_COMMAND_CWD = "(unknown)";

export function streamedTextDisplayItem(params: {
  id: string;
  turnId: string;
  label: string;
  delta: string;
  kind: Extract<DisplayKind, "tool" | "hook" | "reasoning">;
}): DisplayItem {
  return {
    id: params.id,
    kind: params.kind,
    role: "tool",
    text: `${params.label}: ${params.delta}`,
    turnId: params.turnId,
    sourceItemId: params.id,
  };
}

export function streamedToolOutputDisplayItem(params: { id: string; turnId: string; output: string; fallbackLabel: string }): DisplayItem {
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

export function streamedItemOutputDisplayItem(params: {
  id: string;
  turnId: string;
  output: string;
  kind: "command" | "fileChange";
  fallbackText: string;
}): DisplayItem {
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
  } as DisplayItem;
}

export function streamingFileChangeDisplayItem(itemId: string, turnId: string, changes: FileUpdateChange[], status: string): DisplayItem {
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
