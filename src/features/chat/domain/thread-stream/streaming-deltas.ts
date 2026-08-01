import { streamedTextThreadStreamItem, streamedToolOutputThreadStreamItem } from "./factories/streaming-items";
import { normalizeProposedPlanMarkdown } from "./format/proposed-plan";
import type { ThreadStreamItem } from "./items";

export function appendAssistantStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  delta: string,
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== "dialogue" || matching.dialogueKind !== "assistantResponse") return matching;
    const text = `${matching.text}${delta}`;
    return {
      ...matching,
      text,
      copyText: text,
      turnId: matching.turnId ?? turnId,
      dialogueState: "streaming",
    };
  }
  return streamedAssistantDialogueItem(itemId, turnId, delta, "assistantResponse");
}

export function appendPlanStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  delta: string,
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== "dialogue" || matching.role !== "assistant") return matching;
    const text = normalizeProposedPlanMarkdown(`${matching.text}${delta}`);
    return {
      ...matching,
      dialogueKind: "proposedPlan",
      text,
      copyText: text,
      turnId: matching.turnId ?? turnId,
      dialogueState: "streaming",
    };
  }
  return streamedAssistantDialogueItem(itemId, turnId, normalizeProposedPlanMarkdown(delta), "proposedPlan");
}

export function appendTextStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: "tool" | "hook" | "reasoning",
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== kind) return matching;
    return { ...matching, text: `${matching.text ?? ""}${delta}`, turnId: matching.turnId ?? turnId };
  }
  return streamedTextThreadStreamItem({ id: itemId, turnId, label, delta, kind });
}

export function appendToolOutputStreamingDelta(
  current: ThreadStreamItem | null,
  itemId: string,
  turnId: string,
  delta: string,
  fallbackLabel: string,
  options: { readonly allowReasoning?: boolean } = {},
): ThreadStreamItem {
  const matching = matchingSourceItem(current, itemId);
  if (matching) {
    if (matching.kind !== "tool" && matching.kind !== "hook" && !(options.allowReasoning && matching.kind === "reasoning")) {
      return matching;
    }
    return { ...matching, output: `${matching.output ?? ""}${delta}`, turnId: matching.turnId ?? turnId };
  }
  return streamedToolOutputThreadStreamItem({ id: itemId, turnId, output: delta, fallbackLabel });
}

function matchingSourceItem(current: ThreadStreamItem | null, itemId: string): ThreadStreamItem | null {
  if (!current) return null;
  return current.id === itemId || current.sourceItemId === itemId ? current : null;
}

function streamedAssistantDialogueItem(
  itemId: string,
  turnId: string,
  text: string,
  dialogueKind: "assistantResponse" | "proposedPlan",
): ThreadStreamItem {
  return {
    id: itemId,
    kind: "dialogue",
    dialogueKind,
    role: "assistant",
    text,
    copyText: text,
    turnId,
    sourceItemId: itemId,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: itemId },
    dialogueState: "streaming",
  };
}
