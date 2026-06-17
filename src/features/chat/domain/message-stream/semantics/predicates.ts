import type { MessageStreamMeaningEvent, MessageStreamMeaningPlane, MessageStreamSemanticClassification } from "./types";

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

function messageStreamIsPermissionDecision(classification: MessageStreamSemanticClassification): boolean {
  return messageStreamHasMeaning(classification, "permission", "decision");
}

export function messageStreamIsAutoReviewDecision(classification: MessageStreamSemanticClassification): boolean {
  const { provenance } = classification;
  if (!messageStreamIsPermissionDecision(classification) || !provenance) return false;
  if (provenance.source === "appServer" && provenance.channel === "notification") return provenance.event === "autoReview";
  if (provenance.source === "panel" && provenance.channel === "notice") return provenance.reason === "parsedAutoReview";
  return false;
}
