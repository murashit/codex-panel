import type {
  MessageStreamMeaningEvent,
  MessageStreamMeaningPlane,
  MessageStreamRenderFamily,
  MessageStreamSemanticClassification,
} from "./types";

function messageStreamHasMeaning(
  classification: MessageStreamSemanticClassification,
  plane: MessageStreamMeaningPlane,
  event: MessageStreamMeaningEvent,
): boolean {
  return classification.meaning.plane === plane && classification.meaning.event === event;
}

export function messageStreamIsTurnInitiator(classification: MessageStreamSemanticClassification): boolean {
  return (
    (classification.placement.scope === "turn" || classification.placement.scope === "pendingTurn") &&
    classification.placement.turnRole === "initiator"
  );
}

export function messageStreamIsTurnSteer(classification: MessageStreamSemanticClassification): boolean {
  return (
    (classification.placement.scope === "turn" || classification.placement.scope === "pendingTurn") &&
    classification.placement.turnRole === "steer"
  );
}

export function messageStreamIsWorkspaceResult(classification: MessageStreamSemanticClassification): boolean {
  return messageStreamHasMeaning(classification, "workspace", "result");
}

export function messageStreamIsCoordinationProgress(classification: MessageStreamSemanticClassification): boolean {
  return messageStreamHasMeaning(classification, "coordination", "progress");
}

export function messageStreamIsTaskProgress(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "taskProgress";
}

export function messageStreamIsReasoningProgress(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "reasoning";
}

export function messageStreamIsReviewResult(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "reviewResult";
}

export function messageStreamRenderFamily(classification: MessageStreamSemanticClassification): MessageStreamRenderFamily | null {
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
      return "toolResult";
    case "taskProgress":
    case "agent":
    case "reasoning":
    case "contextCompaction":
      return "work";
  }
  return null;
}

export function messageStreamIsPermissionDecision(classification: MessageStreamSemanticClassification): boolean {
  return messageStreamHasMeaning(classification, "permission", "decision");
}
