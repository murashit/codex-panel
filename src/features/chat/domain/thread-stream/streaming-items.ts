import { normalizeProposedPlanMarkdown } from "./format/proposed-plan";
import { RUNNING_EXECUTION_STATE, type ThreadStreamItem, type ThreadStreamItemKind } from "./items";

export function appendAssistantStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  delta: string,
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== "dialogue" || matching.dialogueKind !== "assistantResponse") return matching;
    const text = `${matching.text}${delta}`;
    return {
      ...matching,
      text,
      copyText: text,
      turnId: matching.turnId ?? turnId,
      dialogueState: "streaming",
    };
  }
  return streamedAssistantDialogueItem(itemId, turnId, delta, "assistantResponse");
}

export function appendPlanStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  delta: string,
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== "dialogue" || matching.role !== "assistant") return matching;
    const text = normalizeProposedPlanMarkdown(`${matching.text}${delta}`);
    return {
      ...matching,
      dialogueKind: "proposedPlan",
      text,
      copyText: text,
      turnId: matching.turnId ?? turnId,
      dialogueState: "streaming",
    };
  }
  return streamedAssistantDialogueItem(itemId, turnId, normalizeProposedPlanMarkdown(delta), "proposedPlan");
}

export function appendTextStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: "tool" | "hook" | "reasoning",
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== kind) return matching;
    return { ...matching, text: `${matching.text ?? ""}${delta}`, turnId: matching.turnId ?? turnId };
  }
  return streamedTextThreadStreamItem({ id: itemId, turnId, label, delta, kind });
}

export function appendToolOutputStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
  options: { readonly allowReasoning?: boolean } = {},
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== "tool" && matching.kind !== "hook" && !(options.allowReasoning && matching.kind === "reasoning")) {
      return matching;
    }
    return { ...matching, output: `${matching.output ?? ""}${delta}`, turnId: matching.turnId ?? turnId };
  }
  return streamedToolOutputThreadStreamItem({ id: itemId, turnId, output: delta, fallbackLabel });
}

function matchingSourceItem(current: ThreadStreamItem | null, itemId: string): ThreadStreamItem | null {
  if (!current) return null;
  return current.id === itemId || current.sourceItemId === itemId ? current : null;
}

function streamedAssistantDialogueItem(
  itemId: string,
  turnId: string,
  text: string,
  dialogueKind: "assistantResponse" | "proposedPlan",
): ThreadStreamItem {
  return {
    id: itemId,
    kind: "dialogue",
    dialogueKind,
    role: "assistant",
    text,
    copyText: text,
    turnId,
    sourceItemId: itemId,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: itemId },
    dialogueState: "streaming",
  };
}

export const STREAMED_COMMAND_RUNNING_TEXT = "Command running";
export const STREAMED_MCP_PROGRESS_LABEL = "mcp progress";
const UNKNOWN_STREAMED_COMMAND_CWD = "(unknown)";

function streamedTextThreadStreamItem(params: {
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

function streamedToolOutputThreadStreamItem(params: {
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
