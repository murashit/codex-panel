import type { MessageStreamSemanticClassification } from "../../domain/message-stream/semantics";

export type MessageStreamRenderFamily = "text" | "detail" | "status";

export function messageStreamRenderFamily(classification: MessageStreamSemanticClassification): MessageStreamRenderFamily {
  switch (classification.item.kind) {
    case "message":
    case "system":
    case "userInputResult":
      return "text";
    case "command":
    case "fileChange":
    case "tool":
    case "hook":
    case "goal":
    case "approvalResult":
    case "reviewResult":
    case "agent":
      return "detail";
    case "taskProgress":
    case "reasoning":
    case "wait":
    case "contextCompaction":
      return "status";
  }
  return "status";
}
