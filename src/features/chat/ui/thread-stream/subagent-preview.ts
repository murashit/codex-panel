import { normalizeProposedPlanMarkdown } from "../../domain/thread-stream/format/proposed-plan";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { agentMessagePreview } from "./agent-message-preview";
import { detailPreviewSummary } from "./detail-view";

export function subagentActivityPreview(item: ThreadStreamItem | null, workspaceRoot: string): string | null {
  if (!item) return null;
  switch (item.kind) {
    case "dialogue":
      return item.role === "assistant"
        ? agentMessagePreview(
            item.dialogueKind === "proposedPlan" && item.dialogueState === "streaming"
              ? normalizeProposedPlanMarkdown(item.text)
              : item.text,
          )
        : null;
    case "reasoning":
      return agentMessagePreview(stripStreamingLabel(item.text, "reasoning")) ?? "Reasoning";
    case "taskProgress":
      return agentMessagePreview(item.steps.find((step) => step.status === "inProgress")?.step ?? item.explanation) ?? "Updating plan";
    case "contextCompaction":
      return "Compacting context";
    case "wait":
      return agentMessagePreview(item.text) ?? "Waiting for agents";
    case "system":
    case "goal":
    case "approvalResult":
    case "userInputResult":
      return null;
    default:
      return agentMessagePreview(detailPreviewSummary(item, workspaceRoot));
  }
}

function stripStreamingLabel(text: string | undefined, label: string): string | null {
  if (!text) return null;
  const prefix = `${label}:`;
  return text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : text;
}
