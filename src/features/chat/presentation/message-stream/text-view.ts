import type { ExecutionState, MessageStreamItem } from "../../domain/message-stream/model/items";
import type { MessageStreamItemAnnotations } from "./layout";

export type TextMessageStreamItem = Extract<MessageStreamItem, { kind: "message" | "system" | "userInputResult" }>;

export interface MessageStreamTextView {
  item: TextMessageStreamItem;
  className: string;
  contentKey: string;
  contentMode: "markdown" | "text";
  collapsible: boolean;
  annotations?: MessageStreamItemAnnotations;
  editedFiles: readonly string[];
  autoReviewSummaries: readonly string[];
}

export function messageStreamTextView(item: TextMessageStreamItem, annotations?: MessageStreamItemAnnotations): MessageStreamTextView {
  const contentMode = textContentMode(item);
  return {
    item,
    className: `${textItemClass(item)}${executionClassName(item.executionState ?? null)}`,
    contentKey: `${item.id}\u001f${contentMode}`,
    contentMode,
    collapsible: item.kind === "message" && item.role === "user",
    ...definedProp("annotations", annotations),
    editedFiles: annotations?.editedFiles ?? [],
    autoReviewSummaries: annotations?.autoReviewSummaries ?? [],
  };
}

function textContentMode(item: TextMessageStreamItem): "markdown" | "text" {
  return item.kind === "message" && (item.messageKind !== "proposedPlan" || item.messageState === "completed") ? "markdown" : "text";
}

function executionClassName(state: ExecutionState): string {
  return state ? ` codex-panel__execution codex-panel__execution--${state}` : "";
}

function textItemClass(item: MessageStreamItem): string {
  const classes = ["codex-panel__message", `codex-panel__message--${item.role}`];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
