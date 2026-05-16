import { executionState } from "./model";
import type { DisplayItem } from "./types";

export interface DisplayItemSignatureContext {
  busy: boolean;
  activeTurnId: string | null;
  displayItems: DisplayItem[];
  workspaceRoot?: string | null;
  canRollbackItem?: (item: DisplayItem) => boolean;
}

export function displayItemSignature(item: DisplayItem, context: DisplayItemSignatureContext): string {
  return [
    item.id,
    item.kind,
    item.role,
    item.turnId ?? "",
    item.itemId ?? "",
    item.text,
    "markdown" in item ? String(item.markdown ?? true) : "",
    item.kind === "message" ? (item.copyText ?? "") : "",
    "output" in item ? (item.output ?? "") : "",
    "details" in item ? JSON.stringify(item.details ?? []) : "",
    item.kind === "message" ? (item.editedFiles?.join("\n") ?? "") : "",
    item.kind === "message" ? (item.autoReviewSummaries?.join("\n") ?? "") : "",
    item.kind === "message" ? String(context.canRollbackItem?.(item) ?? false) : "",
    item.kind === "reasoning" && isReasoningActive(item, context) ? "reasoning-active" : "",
    executionState(item) ?? "",
    item.kind === "fileChange" ? JSON.stringify(item.changes) : "",
    item.kind === "fileChange" ? (context.workspaceRoot ?? "") : "",
    item.kind === "taskProgress" ? JSON.stringify({ explanation: item.explanation, steps: item.steps, status: item.status }) : "",
    item.kind === "agent"
      ? JSON.stringify({
          tool: item.tool,
          status: item.status,
          senderThreadId: item.senderThreadId,
          receiverThreadIds: item.receiverThreadIds,
          prompt: item.prompt,
          model: item.model,
          reasoningEffort: item.reasoningEffort,
          agents: item.agents,
        })
      : "",
    item.kind === "command" ? [item.command, item.cwd, item.status, item.exitCode ?? "", item.durationMs ?? ""].join("\n") : "",
    item.kind === "fileChange" ? item.status : "",
    item.kind === "tool" || item.kind === "taskProgress" || item.kind === "agent" || item.kind === "hook" || item.kind === "reasoning"
      ? (item.status ?? "")
      : "",
  ].join("\u0000");
}

export function isReasoningActive(
  item: DisplayItem,
  context: Pick<DisplayItemSignatureContext, "busy" | "activeTurnId" | "displayItems">,
): boolean {
  if (!context.busy || !context.activeTurnId || item.turnId !== context.activeTurnId) return false;
  if (executionState(item) === "completed") return false;
  const latestActiveTurnItem = [...context.displayItems].reverse().find((candidate) => candidate.turnId === context.activeTurnId);
  return latestActiveTurnItem?.id === item.id;
}
