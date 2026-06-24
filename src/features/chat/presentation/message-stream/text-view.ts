import type {
  ExecutionState,
  MessageStreamItem,
  MessageStreamNoticeSection,
  MessageStreamUserInputQuestionResult,
} from "../../domain/message-stream/items";
import type { PlanImplementationTarget } from "../../domain/message-stream/selectors";
import type { MessageStreamItemAnnotations } from "./layout";

export interface MessageStreamForkTarget {
  itemId: string;
  turnId: string;
}

export interface MessageStreamTextActionTargets {
  fork?: MessageStreamForkTarget;
  rollback?: true;
  implementPlan?: PlanImplementationTarget;
}

export interface ReferencedThreadTextView {
  title: string;
  includedTurns: number;
  turnLimit: number;
}

export interface MentionedFileTextView {
  name: string;
  path: string;
}

export interface EditedFilesTextView {
  files: readonly string[];
  turnDiff?: {
    turnId: string;
    diff: string;
  };
}

export interface TextItemDetailSectionView {
  title?: string;
  facts?: readonly { readonly key: string; readonly value: string }[];
  body?: string;
}

interface MessageStreamTextMetadataView {
  editedFiles?: EditedFilesTextView;
  referencedThread?: ReferencedThreadTextView;
  mentionedFiles?: {
    itemId: string;
    files: readonly MentionedFileTextView[];
  };
  autoReviewSummaries: readonly string[];
  systemDetails: readonly TextItemDetailSectionView[];
  userInputDetails: readonly TextItemDetailSectionView[];
}

export interface MessageStreamTextView {
  id: string;
  roleLabel: string;
  body: string;
  className: string;
  contentKey: string;
  renderMode: MessageStreamTextRenderMode;
  collapsible: boolean;
  copyText?: string;
  actionTargets: MessageStreamTextActionTargets;
  metadata: MessageStreamTextMetadataView;
}

type MessageStreamTextRenderMode = "text" | "streamMarkdown" | "obsidianMarkdown";

export function messageStreamTextView(
  item: MessageStreamItem,
  annotations?: MessageStreamItemAnnotations,
  options: { activeTurnId?: string | null; actionTargets?: MessageStreamTextActionTargets } = {},
): MessageStreamTextView {
  const renderMode = textRenderMode(item);
  const body = bodyForTextItem(item);
  return {
    id: item.id,
    roleLabel: roleLabelForTextItem(item),
    body,
    className: `${textItemClass(item)}${executionClassName(item.executionState ?? null)}`,
    contentKey: `${item.id}\u001f${renderMode}`,
    renderMode,
    collapsible: item.kind === "message" && item.role === "user",
    ...definedProp("copyText", copyTextForTextItem(item, options.activeTurnId ?? null)),
    actionTargets: options.actionTargets ?? {},
    metadata: textMetadataView(item, annotations),
  };
}

function textRenderMode(item: MessageStreamItem): MessageStreamTextRenderMode {
  if (item.kind !== "message") return "text";
  if (item.messageKind === "assistantResponse" && item.messageState === "streaming") return "streamMarkdown";
  return item.messageKind !== "proposedPlan" || item.messageState === "completed" ? "obsidianMarkdown" : "text";
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

function textMetadataView(item: MessageStreamItem, annotations?: MessageStreamItemAnnotations): MessageStreamTextMetadataView {
  return {
    ...definedProp("editedFiles", editedFilesView(item, annotations)),
    ...definedProp("referencedThread", referencedThreadView(item)),
    ...definedProp("mentionedFiles", mentionedFilesView(item)),
    autoReviewSummaries: item.kind === "message" ? (annotations?.autoReviewSummaries ?? []) : [],
    systemDetails: item.kind === "system" ? systemDetailViews(item.noticeSections ?? []) : [],
    userInputDetails: item.kind === "userInputResult" ? userInputQuestionDetailViews(item.questions) : [],
  };
}

function editedFilesView(item: MessageStreamItem, annotations?: MessageStreamItemAnnotations): EditedFilesTextView | undefined {
  if (item.kind !== "message" || !annotations?.editedFiles || annotations.editedFiles.length === 0) return undefined;
  return {
    files: annotations.editedFiles,
    ...definedProp("turnDiff", item.turnId && annotations.turnDiff ? { turnId: item.turnId, diff: annotations.turnDiff.diff } : undefined),
  };
}

function referencedThreadView(item: MessageStreamItem): ReferencedThreadTextView | undefined {
  if (item.kind !== "message" || !item.referencedThread) return undefined;
  return item.referencedThread;
}

function mentionedFilesView(item: MessageStreamItem): MessageStreamTextMetadataView["mentionedFiles"] | undefined {
  if (item.kind !== "message" || !item.mentionedFiles || item.mentionedFiles.length === 0) return undefined;
  return { itemId: item.id, files: item.mentionedFiles };
}

function systemDetailViews(sections: readonly MessageStreamNoticeSection[]): readonly TextItemDetailSectionView[] {
  return sections.map((section) => ({
    ...(section.title !== undefined ? { title: section.title } : {}),
    ...(section.auditFacts !== undefined ? { facts: section.auditFacts } : {}),
    ...(section.body !== undefined ? { body: section.body } : {}),
  }));
}

function userInputQuestionDetailViews(questions: readonly MessageStreamUserInputQuestionResult[]): readonly TextItemDetailSectionView[] {
  return questions.map((question) => ({
    title: `Question: ${question.header}`,
    facts: [
      { key: "Prompt", value: question.question },
      ...(question.answer !== undefined ? [{ key: "Answer", value: question.answer }] : []),
    ],
  }));
}

function executionClassName(state: ExecutionState): string {
  if (state === "completed") return " codex-panel__execution codex-panel__execution--completed";
  if (state === "failed") return " codex-panel__execution codex-panel__execution--failed";
  if (state === "running") return " codex-panel__execution codex-panel__execution--running";
  return "";
}

function textItemClass(item: MessageStreamItem): string {
  const classes = ["codex-panel__message", messageRoleClassName(item.role)];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}

function messageRoleClassName(role: MessageStreamItem["role"]): string {
  if (role === "assistant") return "codex-panel__message--assistant";
  if (role === "system") return "codex-panel__message--system";
  if (role === "tool") return "codex-panel__message--tool";
  return "codex-panel__message--user";
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
