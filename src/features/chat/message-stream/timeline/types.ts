import type {
  AgentMessageStreamItem,
  ApprovalResultMessageStreamItem,
  CommandMessageStreamItem,
  ContextCompactionMessageStreamItem,
  MessageStreamDetailSection,
  MessageStreamFileChange,
  MessageStreamItem,
  ExecutionState,
  FileChangeMessageStreamItem,
  GoalMessageStreamItem,
  HookMessageStreamItem,
  MessageStreamMessageItem,
  ReasoningMessageStreamItem,
  ReviewResultMessageStreamItem,
  TaskProgressMessageStreamItem,
  ToolCallMessageStreamItem,
} from "../items";

export type TimelineSemanticKind =
  | "userPrompt"
  | "steering"
  | "assistantResponse"
  | "proposedPlan"
  | "commandRun"
  | "filePatch"
  | "toolCall"
  | "hookRun"
  | "reasoningNote"
  | "taskProgress"
  | "agentActivity"
  | "contextCompaction"
  | "goalChange"
  | "approvalResult"
  | "userInputResult"
  | "reviewResult"
  | "systemNotice";

export type TimelineAuthorship = "user" | "assistant" | "runtime" | "panel";
export type TimelinePlacement = "primaryTranscript" | "workLog" | "liveStatus" | "panelNotice";
export type TimelineDetailShape =
  | "markdownText"
  | "plainText"
  | "commandAudit"
  | "diffSet"
  | "jsonAudit"
  | "taskList"
  | "agentActivity"
  | "eventSummary";
export type TimelineRenderSurface = "textMessage" | "toolResult" | "workItem";

export interface TimelineActions {
  canForkFromHere: boolean;
  canRollbackToPrompt: boolean;
  canImplementPlan: boolean;
  isTurnOutcome: boolean;
}

interface TimelineBaseItem<Item extends MessageStreamItem = MessageStreamItem> {
  id: string;
  sourceItemId?: string;
  turnId?: string;
  semanticKind: TimelineSemanticKind;
  authorship: TimelineAuthorship;
  placement: TimelinePlacement;
  detailShape: TimelineDetailShape;
  renderSurface: TimelineRenderSurface;
  lifecycle: ExecutionState;
  text: string;
  copyText?: string;
  actions: TimelineActions;
  streamItem: Item;
}

interface TimelineTextItem extends TimelineBaseItem<
  MessageStreamMessageItem | Extract<MessageStreamItem, { kind: "system" | "userInputResult" }>
> {
  detailShape: "markdownText" | "plainText" | "eventSummary";
  renderSurface: "textMessage";
}

interface TimelineToolResultItem extends TimelineBaseItem<
  | CommandMessageStreamItem
  | FileChangeMessageStreamItem
  | GoalMessageStreamItem
  | ToolCallMessageStreamItem
  | HookMessageStreamItem
  | ApprovalResultMessageStreamItem
  | ReviewResultMessageStreamItem
> {
  detailShape: "commandAudit" | "diffSet" | "jsonAudit" | "eventSummary" | "plainText";
  renderSurface: "toolResult";
  details?: readonly MessageStreamDetailSection[];
  changes?: readonly MessageStreamFileChange[];
}

interface TimelineWorkItem extends TimelineBaseItem<
  TaskProgressMessageStreamItem | AgentMessageStreamItem | ReasoningMessageStreamItem | ContextCompactionMessageStreamItem
> {
  detailShape: "taskList" | "agentActivity" | "plainText" | "eventSummary";
  renderSurface: "workItem";
}

export type TimelineItem = TimelineTextItem | TimelineToolResultItem | TimelineWorkItem;
