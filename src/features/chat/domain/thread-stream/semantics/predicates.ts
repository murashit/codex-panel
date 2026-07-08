import type { ThreadStreamMeaningEvent, ThreadStreamMeaningPlane, ThreadStreamSemanticClassification } from "./types";

function threadStreamHasMeaning(
  classification: ThreadStreamSemanticClassification,
  plane: ThreadStreamMeaningPlane,
  event: ThreadStreamMeaningEvent,
): boolean {
  return classification.meaning.plane === plane && classification.meaning.event === event;
}

export function threadStreamIsTurnInitiator(classification: ThreadStreamSemanticClassification): boolean {
  return (
    (classification.placement.scope === "turn" || classification.placement.scope === "pendingTurn") &&
    classification.placement.turnRole === "initiator"
  );
}

export function threadStreamIsTurnSteer(classification: ThreadStreamSemanticClassification): boolean {
  return (
    (classification.placement.scope === "turn" || classification.placement.scope === "pendingTurn") &&
    classification.placement.turnRole === "steer"
  );
}

export function threadStreamIsWorkspaceResult(classification: ThreadStreamSemanticClassification): boolean {
  return threadStreamHasMeaning(classification, "workspace", "result");
}

export function threadStreamIsCoordinationProgress(classification: ThreadStreamSemanticClassification): boolean {
  return threadStreamHasMeaning(classification, "coordination", "progress");
}

function threadStreamIsPermissionDecision(classification: ThreadStreamSemanticClassification): boolean {
  return threadStreamHasMeaning(classification, "permission", "decision");
}

export function threadStreamIsAutoReviewDecision(classification: ThreadStreamSemanticClassification): boolean {
  const { provenance } = classification;
  if (!threadStreamIsPermissionDecision(classification) || !provenance) return false;
  if (provenance.source === "appServer" && provenance.channel === "notification") return provenance.event === "autoReview";
  if (provenance.source === "panel" && provenance.channel === "notice") return provenance.reason === "parsedAutoReview";
  return false;
}
