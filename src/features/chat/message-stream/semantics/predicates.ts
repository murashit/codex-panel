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

export function messageStreamIsProposedPlan(classification: MessageStreamSemanticClassification): boolean {
  return messageStreamHasMeaning(classification, "dialogue", "proposal");
}

export function messageStreamIsAssistantResponse(classification: MessageStreamSemanticClassification): boolean {
  return messageStreamHasMeaning(classification, "dialogue", "response");
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

export function messageStreamIsContextCompaction(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "contextCompaction";
}

export function messageStreamIsCommandEvidence(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "command";
}

export function messageStreamIsToolEvidence(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "tool";
}

export function messageStreamIsHookEvidence(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "hook";
}

export function messageStreamIsApprovalResult(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "approvalResult";
}

export function messageStreamIsUserInputResult(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "userInputResult";
}

export function messageStreamIsReviewResult(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "reviewResult";
}

export function messageStreamIsGoalChange(classification: MessageStreamSemanticClassification): boolean {
  return classification.item.kind === "goal";
}

export function messageStreamRenderFamily(classification: MessageStreamSemanticClassification): MessageStreamRenderFamily | null {
  if (classification.item.kind === "message" || classification.item.kind === "system" || messageStreamIsUserInputResult(classification)) {
    return "text";
  }
  if (
    messageStreamIsCommandEvidence(classification) ||
    messageStreamIsWorkspaceResult(classification) ||
    messageStreamIsToolEvidence(classification) ||
    messageStreamIsHookEvidence(classification) ||
    messageStreamIsGoalChange(classification) ||
    messageStreamIsApprovalResult(classification) ||
    messageStreamIsReviewResult(classification)
  ) {
    return "toolResult";
  }
  if (
    messageStreamIsTaskProgress(classification) ||
    messageStreamIsCoordinationProgress(classification) ||
    messageStreamIsReasoningProgress(classification) ||
    messageStreamIsContextCompaction(classification)
  ) {
    return "work";
  }
  return null;
}

export function messageStreamIsPermissionDecision(classification: MessageStreamSemanticClassification): boolean {
  return messageStreamHasMeaning(classification, "permission", "decision");
}
