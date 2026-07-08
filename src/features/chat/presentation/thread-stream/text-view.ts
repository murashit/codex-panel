import type {
  ExecutionState,
  ThreadStreamItem,
  ThreadStreamNoticeSection,
  ThreadStreamUserInputQuestionResult,
} from "../../domain/thread-stream/items";
import type { PlanImplementationTarget } from "../../domain/thread-stream/selectors";
import type { ThreadStreamItemAnnotations } from "./layout";

export interface ThreadStreamForkTarget {
  itemId: string;
  turnId: string;
}

export interface ThreadStreamTextActionTargets {
  fork?: ThreadStreamForkTarget;
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

interface ThreadStreamTextMetadataView {
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

export interface ThreadStreamTextView {
  id: string;
  roleLabel: string;
  body: string;
  className: string;
  contentKey: string;
  renderMode: ThreadStreamTextRenderMode;
  collapsible: boolean;
  copyText?: string;
  actionTargets: ThreadStreamTextActionTargets;
  metadata: ThreadStreamTextMetadataView;
}

type ThreadStreamTextRenderMode = "text" | "streamMarkdown" | "obsidianMarkdown";

export function threadStreamTextView(
  item: ThreadStreamItem,
  annotations?: ThreadStreamItemAnnotations,
  options: { activeTurnId?: string | null; actionTargets?: ThreadStreamTextActionTargets } = {},
): ThreadStreamTextView {
  const renderMode = textRenderMode(item);
  const body = bodyForTextItem(item);
  return {
    id: item.id,
    roleLabel: roleLabelForTextItem(item),
    body,
    className: `${textItemClass(item)}${executionClassName(item.executionState ?? null)}`,
    contentKey: `${item.id}\u001f${renderMode}`,
    renderMode,
    collapsible: item.kind === "dialogue" && item.role === "user",
    ...definedProp("copyText", copyTextForTextItem(item, options.activeTurnId ?? null)),
    actionTargets: options.actionTargets ?? {},
    metadata: textMetadataView(item, annotations),
  };
}

function textRenderMode(item: ThreadStreamItem): ThreadStreamTextRenderMode {
  if (item.kind !== "dialogue") return "text";
  if (item.dialogueKind === "assistantResponse" && item.dialogueState === "streaming") return "streamMarkdown";
  return item.dialogueKind !== "proposedPlan" || item.dialogueState === "completed" ? "obsidianMarkdown" : "text";
}

function bodyForTextItem(item: ThreadStreamItem): string {
  return "text" in item && typeof item.text === "string" ? item.text : "";
}

function roleLabelForTextItem(item: ThreadStreamItem): string {
  if (item.kind === "userInputResult") return "Input";
  if (item.role === "user") return "You";
  if (item.role === "assistant") return "Codex";
  return "System";
}

function copyTextForTextItem(item: ThreadStreamItem, activeTurnId: string | null): string | undefined {
  if (item.kind !== "dialogue" || item.copyText === undefined) return undefined;
  if (activeTurnId && item.role === "assistant" && item.turnId === activeTurnId) return undefined;
  return item.copyText;
}

function textMetadataView(item: ThreadStreamItem, annotations?: ThreadStreamItemAnnotations): ThreadStreamTextMetadataView {
  return {
    ...definedProp("editedFiles", editedFilesView(item, annotations)),
    ...definedProp("referencedThread", referencedThreadView(item)),
    ...definedProp("mentionedFiles", mentionedFilesView(item)),
    autoReviewSummaries: item.kind === "dialogue" ? (annotations?.autoReviewSummaries ?? []) : [],
    systemDetails: item.kind === "system" ? systemDetailViews(item.noticeSections ?? []) : [],
    userInputDetails: item.kind === "userInputResult" ? userInputQuestionDetailViews(item.questions) : [],
  };
}

function editedFilesView(item: ThreadStreamItem, annotations?: ThreadStreamItemAnnotations): EditedFilesTextView | undefined {
  if (item.kind !== "dialogue" || !annotations?.editedFiles || annotations.editedFiles.length === 0) return undefined;
  return {
    files: annotations.editedFiles,
    ...definedProp("turnDiff", item.turnId && annotations.turnDiff ? { turnId: item.turnId, diff: annotations.turnDiff.diff } : undefined),
  };
}

function referencedThreadView(item: ThreadStreamItem): ReferencedThreadTextView | undefined {
  if (item.kind !== "dialogue" || !item.referencedThread) return undefined;
  return item.referencedThread;
}

function mentionedFilesView(item: ThreadStreamItem): ThreadStreamTextMetadataView["mentionedFiles"] | undefined {
  if (item.kind !== "dialogue" || !item.mentionedFiles || item.mentionedFiles.length === 0) return undefined;
  return { itemId: item.id, files: item.mentionedFiles };
}

function systemDetailViews(sections: readonly ThreadStreamNoticeSection[]): readonly TextItemDetailSectionView[] {
  return sections.map((section) => ({
    ...(section.title !== undefined ? { title: section.title } : {}),
    ...(section.auditFacts !== undefined ? { facts: section.auditFacts } : {}),
    ...(section.body !== undefined ? { body: section.body } : {}),
  }));
}

function userInputQuestionDetailViews(questions: readonly ThreadStreamUserInputQuestionResult[]): readonly TextItemDetailSectionView[] {
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

function textItemClass(item: ThreadStreamItem): string {
  const classes = ["codex-panel__message", messageRoleClassName(item.role)];
  if (item.kind === "approvalResult") classes.push("codex-panel__message--approval-result");
  if (item.kind === "userInputResult") classes.push("codex-panel__message--user-input-result");
  if (item.kind === "reviewResult") classes.push("codex-panel__message--review-result");
  return classes.join(" ");
}

function messageRoleClassName(role: ThreadStreamItem["role"]): string {
  if (role === "assistant") return "codex-panel__message--assistant";
  if (role === "system") return "codex-panel__message--system";
  if (role === "tool") return "codex-panel__message--tool";
  return "codex-panel__message--user";
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
