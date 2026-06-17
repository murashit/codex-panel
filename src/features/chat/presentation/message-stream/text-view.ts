import type { ExecutionState, MessageStreamItem } from "../../domain/message-stream/items";
import type { MessageStreamItemAnnotations } from "./layout";

export interface MessageStreamForkTarget {
  itemId: string;
  turnId: string;
}

export interface MessageStreamRollbackTarget {
  itemId: string;
  turnId: string;
}

export interface MessageStreamPlanImplementationTarget {
  itemId: string;
}

export interface MessageStreamTextActions {
  fork?: MessageStreamForkTarget;
  rollback?: MessageStreamRollbackTarget;
  implementPlan?: MessageStreamPlanImplementationTarget;
}

export interface MessageStreamTextView {
  id: string;
  item: MessageStreamItem;
  roleLabel: string;
  body: string;
  className: string;
  contentKey: string;
  contentMode: "markdown" | "text";
  collapsible: boolean;
  copyText?: string;
  actions: MessageStreamTextActions;
  annotations?: MessageStreamItemAnnotations;
  editedFiles: readonly string[];
  autoReviewSummaries: readonly string[];
}

export function messageStreamTextView(
  item: MessageStreamItem,
  annotations?: MessageStreamItemAnnotations,
  options: { activeTurnId?: string | null; actions?: MessageStreamTextActions } = {},
): MessageStreamTextView {
  const contentMode = textContentMode(item);
  const body = bodyForTextItem(item);
  return {
    id: item.id,
    item,
    roleLabel: roleLabelForTextItem(item),
    body,
    className: `${textItemClass(item)}${executionClassName(item.executionState ?? null)}`,
    contentKey: `${item.id}\u001f${contentMode}`,
    contentMode,
    collapsible: item.kind === "message" && item.role === "user",
    ...definedProp("copyText", copyTextForTextItem(item, options.activeTurnId ?? null)),
    actions: options.actions ?? {},
    ...definedProp("annotations", annotations),
    editedFiles: annotations?.editedFiles ?? [],
    autoReviewSummaries: annotations?.autoReviewSummaries ?? [],
  };
}

function textContentMode(item: MessageStreamItem): "markdown" | "text" {
  return item.kind === "message" && (item.messageKind !== "proposedPlan" || item.messageState === "completed") ? "markdown" : "text";
}

function bodyForTextItem(item: MessageStreamItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : "";
}

function roleLabelForTextItem(item: MessageStreamItem): string {
  if (item.kind === "userInputResult") return "Input";
  if (item.role === "user") return "You";
  if (item.role === "assistant") return "Codex";
  return "System";
}

function copyTextForTextItem(item: MessageStreamItem, activeTurnId: string | null): string | undefined {
  if (item.kind !== "message" || item.copyText === undefined) return undefined;
  if (activeTurnId && item.role === "assistant" && item.turnId === activeTurnId) return undefined;
  return item.copyText;
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
