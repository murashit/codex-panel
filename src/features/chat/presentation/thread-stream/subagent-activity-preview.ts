import { truncate } from "../../../../domain/display/text-preview";
import { agentMessagePreview } from "../../domain/thread-stream/format/agent-message-preview";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { detailView } from "./detail-view";

const SUBAGENT_ACTIVITY_PREVIEW_LIMIT = 96;

export function subagentActivityPreview(item: ThreadStreamItem | null, workspaceRoot?: string | null): string | null {
  if (!item) return null;
  switch (item.kind) {
    case "dialogue":
      return item.role === "assistant" ? previewText(item.text) : null;
    case "reasoning":
      return previewText(stripStreamingLabel(item.text, "reasoning")) ?? "Reasoning";
    case "taskProgress":
      return previewText(currentTaskStep(item) ?? item.explanation) ?? "Updating plan";
    case "contextCompaction":
      return "Compacting context";
    case "wait":
      return previewText(item.text) ?? "Waiting for agents";
    case "system":
    case "goal":
    case "approvalResult":
    case "userInputResult":
      return null;
    default:
      return previewText(detailSummary(item, workspaceRoot));
  }
}

function detailSummary(item: ThreadStreamItem, workspaceRoot?: string | null): string {
  const view = detailView(item, workspaceRoot);
  if (view.summary !== "details") return view.summary;
  if ("output" in item && typeof item.output === "string" && item.output.trim().length > 0) return item.output;
  return view.label;
}

function currentTaskStep(item: Extract<ThreadStreamItem, { kind: "taskProgress" }>): string | null {
  return item.steps.find((step) => step.status === "inProgress")?.step ?? null;
}

function stripStreamingLabel(text: string | undefined, label: string): string | null {
  if (!text) return null;
  const prefix = `${label}:`;
  return text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : text;
}

function previewText(text: string | null | undefined): string | null {
  const preview = agentMessagePreview(text ?? null, SUBAGENT_ACTIVITY_PREVIEW_LIMIT);
  return preview ? truncate(preview, SUBAGENT_ACTIVITY_PREVIEW_LIMIT) : null;
}
