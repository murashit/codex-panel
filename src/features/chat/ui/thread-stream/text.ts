import type { ThreadStreamItem, ThreadStreamNoticeSection, ThreadStreamUserInputQuestionResult } from "../../domain/thread-stream/items";
import type { ThreadStreamItemAnnotations } from "./layout";
import {
  type EditedFilesTextView,
  type ReferencedThreadTextView,
  type TextItemDetailSectionView,
  type ThreadStreamTextActionTargets,
  type ThreadStreamTextView,
  threadStreamExecutionClassName,
} from "./model";

type TextItem = Extract<ThreadStreamItem, { kind: "dialogue" | "system" | "userInputResult" }>;

type ThreadStreamTextRenderMode = "text" | "streamMarkdown" | "obsidianMarkdown";
type ThreadStreamTextMetadataView = ThreadStreamTextView["metadata"];

export function threadStreamTextView(
  item: TextItem,
  annotations: ThreadStreamItemAnnotations | undefined,
  options: { activeTurnId: string | null; actionTargets?: ThreadStreamTextActionTargets },
): ThreadStreamTextView {
  const renderMode = textRenderMode(item);
  const body = item.text;
  return {
    id: item.id,
    roleLabel: roleLabelForTextItem(item),
    body,
    className: [textItemClass(item), threadStreamExecutionClassName(item.executionState ?? null)].filter(Boolean).join(" "),
    contentKey: `${item.id}\u001f${renderMode}`,
    renderMode,
    collapsible: item.kind === "dialogue" && item.role === "user",
    ...definedProp("copyText", copyTextForTextItem(item, options.activeTurnId)),
    actionTargets: options.actionTargets ?? {},
    metadata: textMetadataView(item, annotations),
  };
}

function textRenderMode(item: TextItem): ThreadStreamTextRenderMode {
  if (item.kind !== "dialogue") return "text";
  if (item.dialogueKind === "assistantResponse" && item.dialogueState === "streaming") return "streamMarkdown";
  return item.dialogueKind !== "proposedPlan" || item.dialogueState === "completed" ? "obsidianMarkdown" : "text";
}

function roleLabelForTextItem(item: TextItem): string {
  if (item.kind === "userInputResult") return "Input";
  if (item.role === "user") return "You";
  if (item.role === "assistant") return "Codex";
  return "System";
}

function copyTextForTextItem(item: TextItem, activeTurnId: string | null): string | undefined {
  if (item.kind !== "dialogue" || item.copyText === undefined) return undefined;
  if (activeTurnId && item.role === "assistant" && item.turnId === activeTurnId) return undefined;
  return item.copyText;
}

function textMetadataView(item: TextItem, annotations?: ThreadStreamItemAnnotations): ThreadStreamTextMetadataView {
  return {
    ...definedProp("editedFiles", editedFilesView(item, annotations)),
    ...definedProp("referencedThread", referencedThreadView(item)),
    ...definedProp("contextItems", contextItemsView(item)),
    autoReviewSummaries: item.kind === "dialogue" ? (annotations?.autoReviewSummaries ?? []) : [],
    systemDetails: item.kind === "system" ? systemDetailViews(item.noticeSections ?? []) : [],
    userInputDetails: item.kind === "userInputResult" ? userInputQuestionDetailViews(item.questions) : [],
  };
}

function editedFilesView(item: TextItem, annotations?: ThreadStreamItemAnnotations): EditedFilesTextView | undefined {
  if (item.kind !== "dialogue" || !annotations?.editedFiles || annotations.editedFiles.length === 0) return undefined;
  return {
    files: annotations.editedFiles,
    ...definedProp("turnDiff", item.turnId && annotations.turnDiff ? { turnId: item.turnId, diff: annotations.turnDiff.diff } : undefined),
  };
}

function referencedThreadView(item: TextItem): ReferencedThreadTextView | undefined {
  if (item.kind !== "dialogue" || !item.referencedThread) return undefined;
  return item.referencedThread;
}

function contextItemsView(item: TextItem): ThreadStreamTextMetadataView["contextItems"] | undefined {
  if (item.kind !== "dialogue") return undefined;
  const items = [
    ...(item.referencedFiles ?? []).map((file) => ({ label: file.name, detail: file.path })),
    ...(item.contextAttachments ?? []),
  ];
  return items.length > 0 ? { itemId: item.id, items } : undefined;
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

function textItemClass(item: TextItem): string {
  const classes = ["codex-panel__stream-item", streamItemRoleClassName(item.role)];
  if (item.kind === "userInputResult") classes.push("codex-panel__stream-item--user-input-result");
  return classes.join(" ");
}

function streamItemRoleClassName(role: ThreadStreamItem["role"]): string {
  if (role === "assistant") return "codex-panel__stream-item--assistant";
  if (role === "system") return "codex-panel__stream-item--system";
  if (role === "tool") return "codex-panel__stream-item--tool";
  return "codex-panel__stream-item--user";
}

function definedProp<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}
