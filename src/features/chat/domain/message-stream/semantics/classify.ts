import { isLocalSteerMessageClientId } from "../../local-message-ids";
import type { MessageStreamItem } from "../items";
import type {
  MessageStreamLifecycle,
  MessageStreamMeaning,
  MessageStreamPlacement,
  MessageStreamSemanticCapabilities,
  MessageStreamSemanticClassification,
} from "./types";

export function messageStreamSemanticClassifications(items: readonly MessageStreamItem[]): MessageStreamSemanticClassification[] {
  const seenUserMessagesByTurn = new Map<string, number>();
  return items.map((item) => messageStreamSemanticClassification(item, seenUserMessagesByTurn));
}

function messageStreamSemanticClassification(
  item: MessageStreamItem,
  seenUserMessagesByTurn: Map<string, number> = new Map<string, number>(),
): MessageStreamSemanticClassification {
  const placement = placementForMessageStreamItem(item, seenUserMessagesByTurn);
  const meaning = meaningForMessageStreamItem(item);
  const lifecycle = lifecycleForMessageStreamItem(item);
  return {
    item,
    ...definedProp("provenance", item.provenance),
    placement,
    meaning,
    ...definedProp("lifecycle", lifecycle),
    capabilities: messageStreamSemanticCapabilities({ item, placement, meaning, ...definedProp("lifecycle", lifecycle) }),
  };
}

function messageStreamSemanticCapabilities(
  classification: Pick<MessageStreamSemanticClassification, "item" | "placement" | "meaning" | "lifecycle">,
): MessageStreamSemanticCapabilities {
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
    canImplementPlan: item.kind === "message" && item.messageKind === "proposedPlan" && lifecycle?.state === "completed",
    isTurnOutcome: isDialogueOutcome,
  };
}

function placementForMessageStreamItem(item: MessageStreamItem, seenUserMessagesByTurn: Map<string, number>): MessageStreamPlacement {
  if (item.kind === "goal") return { scope: "thread" };
  if (item.kind === "system") return { scope: "panel" };

  if (item.kind === "message" && item.messageKind === "user") {
    const turnRole = isSteeringUserMessage(item, seenUserMessagesByTurn) ? "steer" : "initiator";
    return item.turnId ? { scope: "turn", turnId: item.turnId, turnRole } : { scope: "pendingTurn", turnRole };
  }

  if (item.kind === "message") {
    const turnRole = item.messageState === "completed" ? "outcome" : "detail";
    return item.turnId ? { scope: "turn", turnId: item.turnId, turnRole } : { scope: "panel" };
  }

  if (item.turnId) return { scope: "turn", turnId: item.turnId, turnRole: "detail" };
  if (item.sourceItemId && item.sourceItemId !== item.id) return { scope: "item", parentItemId: item.sourceItemId };
  if (item.kind === "contextCompaction") return { scope: "thread" };
  return { scope: "panel" };
}

function meaningForMessageStreamItem(item: MessageStreamItem): MessageStreamMeaning {
  switch (item.kind) {
    case "message":
      if (item.messageKind === "user") return { plane: "dialogue", event: "request" };
      if (item.messageKind === "proposedPlan") return { plane: "dialogue", event: "proposal" };
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

function reviewResultMeaning(item: Extract<MessageStreamItem, { kind: "reviewResult" }>): MessageStreamMeaning {
  if (item.provenance?.source === "appServer" && item.provenance.channel === "notification" && item.provenance.event === "autoReview") {
    return { plane: "permission", event: "decision" };
  }
  if (item.provenance?.source === "panel" && item.provenance.channel === "notice" && item.provenance.reason === "parsedAutoReview") {
    return { plane: "permission", event: "decision" };
  }
  return { plane: "review", event: "result" };
}

function lifecycleForMessageStreamItem(item: MessageStreamItem): MessageStreamLifecycle | undefined {
  if (item.executionState) return { state: item.executionState };
  if (item.kind === "message" && item.messageKind !== "user") {
    return { state: item.messageState === "streaming" ? "running" : "completed" };
  }
  return undefined;
}

function isSteeringUserMessage(
  item: Extract<MessageStreamItem, { kind: "message" }>,
  seenUserMessagesByTurn: Map<string, number>,
): boolean {
  if (item.messageKind !== "user") return false;
  if (item.provenance?.source === "localUser" && item.provenance.interaction === "steer") return true;
  if (!item.turnId) return false;
  const seenCount = seenUserMessagesByTurn.get(item.turnId) ?? 0;
  seenUserMessagesByTurn.set(item.turnId, seenCount + 1);
  return isLocalSteerMessageClientId(item.clientId) || seenCount > 0;
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
