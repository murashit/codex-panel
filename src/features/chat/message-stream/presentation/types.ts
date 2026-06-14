import type { MessageStreamItem } from "../items";

export type PresentationSemanticKind =
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

export interface PresentationActions {
  canForkFromHere: boolean;
  canRollbackToPrompt: boolean;
  canImplementPlan: boolean;
  isTurnOutcome: boolean;
}

export interface PresentationClassification {
  item: MessageStreamItem;
  semanticKind: PresentationSemanticKind;
  actions: PresentationActions;
}
