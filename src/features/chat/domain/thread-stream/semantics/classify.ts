import type { ThreadStreamItem } from "../items";
import { isLocalSteerMessageClientId } from "../local-message-ids";
import type {
  ThreadStreamLifecycle,
  ThreadStreamMeaning,
  ThreadStreamPlacement,
  ThreadStreamSemanticCapabilities,
  ThreadStreamSemanticClassification,
} from "./types";

export function threadStreamSemanticClassifications(items: readonly ThreadStreamItem[]): ThreadStreamSemanticClassification[] {
  const seenUserMessagesByTurn = new Map<string, number>();
  return items.map((item) => threadStreamSemanticClassification(item, seenUserMessagesByTurn));
}

function threadStreamSemanticClassification(
  item: ThreadStreamItem,
  seenUserMessagesByTurn: Map<string, number> = new Map<string, number>(),
): ThreadStreamSemanticClassification {
  const placement = placementForThreadStreamItem(item, seenUserMessagesByTurn);
  const meaning = meaningForThreadStreamItem(item);
  const lifecycle = lifecycleForThreadStreamItem(item);
  return {
    item,
    ...definedProp("provenance", item.provenance),
    placement,
    meaning,
    ...definedProp("lifecycle", lifecycle),
    capabilities: threadStreamSemanticCapabilities({ item, placement, meaning, ...definedProp("lifecycle", lifecycle) }),
  };
}

function threadStreamSemanticCapabilities(
  classification: Pick<ThreadStreamSemanticClassification, "item" | "placement" | "meaning" | "lifecycle">,
): ThreadStreamSemanticCapabilities {
  const { item, placement, meaning, lifecycle } = classification;
  const isDialogueOutcome =
    placement.scope === "turn" &&
    placement.turnRole === "outcome" &&
    meaning.plane === "dialogue" &&
    (meaning.event === "response" || meaning.event === "proposal") &&
    lifecycle?.state === "completed";

  return {
    canForkFromHere: isDialogueOutcome,
    canRollbackToPrompt: (placement.scope === "turn" || placement.scope === "pendingTurn") && placement.turnRole === "initiator",
    canImplementPlan: item.kind === "dialogue" && item.dialogueKind === "proposedPlan" && lifecycle?.state === "completed",
    isTurnOutcome: isDialogueOutcome,
  };
}

function placementForThreadStreamItem(item: ThreadStreamItem, seenUserMessagesByTurn: Map<string, number>): ThreadStreamPlacement {
  if (item.kind === "goal") return { scope: "thread" };
  if (item.kind === "system") return { scope: "panel" };

  if (item.kind === "dialogue" && item.dialogueKind === "user") {
    const turnRole = isSteeringUserMessage(item, seenUserMessagesByTurn) ? "steer" : "initiator";
    return item.turnId ? { scope: "turn", turnId: item.turnId, turnRole } : { scope: "pendingTurn", turnRole };
  }

  if (item.kind === "dialogue") {
    const turnRole = item.dialogueState === "completed" ? "outcome" : "detail";
    return item.turnId ? { scope: "turn", turnId: item.turnId, turnRole } : { scope: "panel" };
  }

  if (item.turnId) return { scope: "turn", turnId: item.turnId, turnRole: "detail" };
  if (item.sourceItemId && item.sourceItemId !== item.id) return { scope: "item", parentItemId: item.sourceItemId };
  if (item.kind === "contextCompaction") return { scope: "thread" };
  return { scope: "panel" };
}

function meaningForThreadStreamItem(item: ThreadStreamItem): ThreadStreamMeaning {
  switch (item.kind) {
    case "dialogue":
      if (item.dialogueKind === "user") return { plane: "dialogue", event: "request" };
      if (item.dialogueKind === "proposedPlan") return { plane: "dialogue", event: "proposal" };
      return { plane: "dialogue", event: "response" };
    case "command":
    case "tool":
    case "hook":
      return { plane: "execution", event: "evidence" };
    case "fileChange":
      return { plane: "workspace", event: "result" };
    case "reasoning":
    case "wait":
    case "taskProgress":
      return { plane: "execution", event: "progress" };
    case "agent":
      return { plane: "coordination", event: "progress" };
    case "contextCompaction":
    case "goal":
      return { plane: "context", event: "stateChange" };
    case "approvalResult":
      return { plane: "permission", event: "decision" };
    case "userInputResult":
      return { plane: "interaction", event: "response" };
    case "reviewResult":
      return reviewResultMeaning(item);
    case "system":
      return { plane: "diagnostic", event: "notice" };
  }
  return { plane: "diagnostic", event: "notice" };
}

function reviewResultMeaning(item: Extract<ThreadStreamItem, { kind: "reviewResult" }>): ThreadStreamMeaning {
  if (item.provenance?.source === "appServer" && item.provenance.channel === "notification" && item.provenance.event === "autoReview") {
    return { plane: "permission", event: "decision" };
  }
  if (item.provenance?.source === "panel" && item.provenance.channel === "notice" && item.provenance.reason === "parsedAutoReview") {
    return { plane: "permission", event: "decision" };
  }
  return { plane: "review", event: "result" };
}

function lifecycleForThreadStreamItem(item: ThreadStreamItem): ThreadStreamLifecycle | undefined {
  if (item.executionState) return { state: item.executionState };
  if (item.kind === "dialogue" && item.dialogueKind !== "user") {
    return { state: item.dialogueState === "streaming" ? "running" : "completed" };
  }
  return undefined;
}

function isSteeringUserMessage(
  item: Extract<ThreadStreamItem, { kind: "dialogue" }>,
  seenUserMessagesByTurn: Map<string, number>,
): boolean {
  if (item.dialogueKind !== "user") return false;
  if (item.provenance?.source === "localUser" && item.provenance.interaction === "steer") return true;
  if (!item.turnId) return false;
  const seenCount = seenUserMessagesByTurn.get(item.turnId) ?? 0;
  seenUserMessagesByTurn.set(item.turnId, seenCount + 1);
  return isLocalSteerMessageClientId(item.clientId) || seenCount > 0;
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
