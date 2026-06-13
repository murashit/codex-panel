import type {
  AgentDisplayItem,
  ApprovalResultDisplayItem,
  CommandDisplayItem,
  ContextCompactionDisplayItem,
  DisplayDetailSection,
  DisplayFileChange,
  DisplayItem,
  ExecutionState,
  FileChangeDisplayItem,
  GoalDisplayItem,
  HookDisplayItem,
  MessageDisplayItem,
  ReasoningDisplayItem,
  ReviewResultDisplayItem,
  TaskProgressDisplayItem,
  ToolCallDisplayItem,
} from "../types";

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

interface TimelineBaseItem<Item extends DisplayItem = DisplayItem> {
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
  displayItem: Item;
}

interface TimelineTextItem extends TimelineBaseItem<MessageDisplayItem | Extract<DisplayItem, { kind: "system" | "userInputResult" }>> {
  detailShape: "markdownText" | "plainText" | "eventSummary";
  renderSurface: "textMessage";
}

interface TimelineToolResultItem extends TimelineBaseItem<
  | CommandDisplayItem
  | FileChangeDisplayItem
  | GoalDisplayItem
  | ToolCallDisplayItem
  | HookDisplayItem
  | ApprovalResultDisplayItem
  | ReviewResultDisplayItem
> {
  detailShape: "commandAudit" | "diffSet" | "jsonAudit" | "eventSummary" | "plainText";
  renderSurface: "toolResult";
  details?: readonly DisplayDetailSection[];
  changes?: readonly DisplayFileChange[];
}

interface TimelineWorkItem extends TimelineBaseItem<
  TaskProgressDisplayItem | AgentDisplayItem | ReasoningDisplayItem | ContextCompactionDisplayItem
> {
  detailShape: "taskList" | "agentActivity" | "plainText" | "eventSummary";
  renderSurface: "workItem";
}

export type TimelineItem = TimelineTextItem | TimelineToolResultItem | TimelineWorkItem;
