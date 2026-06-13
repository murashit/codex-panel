import type { ReferencedThreadMetadata } from "../../../domain/threads/reference";

export type DisplayKind =
  | "message"
  | "command"
  | "fileChange"
  | "tool"
  | "taskProgress"
  | "agent"
  | "hook"
  | "reasoning"
  | "contextCompaction"
  | "system"
  | "goal"
  | "approvalResult"
  | "userInputResult"
  | "reviewResult";
type DisplayRole = "user" | "assistant" | "system" | "tool";
export type ExecutionState = "running" | "completed" | "failed" | null;
type MessageState = "streaming" | "completed";

interface DisplayBase {
  id: string;
  kind: DisplayKind;
  role: DisplayRole;
  text: string;
  turnId?: string;
  sourceItemId?: string;
  executionState?: ExecutionState;
}

export interface DisplayDetailMetaRow {
  key: string;
  value: string;
}

export interface DisplayDetailSection {
  title?: string;
  body?: string;
  rows?: DisplayDetailMetaRow[];
}

interface MessageDisplayBase extends DisplayBase {
  kind: "message";
  role: "user" | "assistant";
  clientId?: string;
  copyText?: string;
  referencedThread?: ReferencedThreadMetadata;
  mentionedFiles?: DisplayFileMention[];
  editedFiles?: string[];
  turnDiff?: DisplayTurnDiff;
  autoReviewSummaries?: string[];
}

interface UserMessageDisplayItem extends MessageDisplayBase {
  messageKind: "user";
  role: "user";
  messageState?: never;
}

interface AssistantResponseMessageDisplayItem extends MessageDisplayBase {
  messageKind: "assistantResponse";
  role: "assistant";
  messageState: MessageState;
}

interface ProposedPlanMessageDisplayItem extends MessageDisplayBase {
  messageKind: "proposedPlan";
  role: "assistant";
  messageState: MessageState;
}

export type AssistantAuthoredMessageDisplayItem = AssistantResponseMessageDisplayItem | ProposedPlanMessageDisplayItem;

export type MessageDisplayItem = UserMessageDisplayItem | AssistantAuthoredMessageDisplayItem;

export interface DisplayFileMention {
  name: string;
  path: string;
}

interface DisplayTurnDiff {
  diff: string;
}

interface SystemMessageDisplayItem extends DisplayBase {
  kind: "system";
  role: "system";
  details?: DisplayDetailSection[];
}

export interface GoalDisplayItem extends DisplayBase {
  kind: "goal";
  role: "tool";
  objective?: string;
  details?: DisplayDetailSection[];
}

interface UserInputResultDisplayItem extends DisplayBase {
  kind: "userInputResult";
  role: "tool";
  details?: DisplayDetailSection[];
}

export interface ApprovalResultDisplayItem extends DisplayBase {
  kind: "approvalResult";
  role: "tool";
  details?: DisplayDetailSection[];
}

export interface ReviewResultDisplayItem extends DisplayBase {
  kind: "reviewResult";
  role: "tool";
  details?: DisplayDetailSection[];
}

export interface CommandDisplayItem extends DisplayBase {
  kind: "command";
  role: "tool";
  actionLabel?: string;
  command: string;
  cwd: string;
  status: string;
  exitCode?: number;
  durationMs?: number;
  output?: string;
}

export interface DisplayFileChange {
  kind: string;
  path: string;
  diff: string;
}

export interface FileChangeDisplayItem extends DisplayBase {
  kind: "fileChange";
  role: "tool";
  status: string;
  changes: DisplayFileChange[];
  output?: string;
}

interface ToolDisplayBase extends DisplayBase {
  role: "tool";
  activityKind?: "userSteered";
  toolLabel?: string;
  summaryPath?: boolean;
  status?: string;
  output?: string;
  details?: DisplayDetailSection[];
}

export interface ToolCallDisplayItem extends ToolDisplayBase {
  kind: "tool";
}

export interface HookDisplayItem extends ToolDisplayBase {
  kind: "hook";
}

export interface ReasoningDisplayItem extends ToolDisplayBase {
  kind: "reasoning";
}

export interface ContextCompactionDisplayItem extends DisplayBase {
  kind: "contextCompaction";
  role: "tool";
}

interface TaskProgressStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

export interface TaskProgressDisplayItem extends DisplayBase {
  kind: "taskProgress";
  role: "tool";
  explanation: string | null;
  steps: TaskProgressStep[];
  status: string;
}

export interface AgentStateDisplay {
  threadId: string;
  status: string;
  message: string | null;
}

export interface AgentRunSummaryAgent {
  threadId: string;
  status: string;
  messagePreview: string | null;
}

export interface AgentDisplayItem extends DisplayBase {
  kind: "agent";
  role: "tool";
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agents: AgentStateDisplay[];
}

export interface AgentRunSummary {
  running: number;
  completed: number;
  failed: number;
  agents: AgentRunSummaryAgent[];
  additionalAgents: number;
}

export type DisplayItem =
  | MessageDisplayItem
  | SystemMessageDisplayItem
  | GoalDisplayItem
  | UserInputResultDisplayItem
  | CommandDisplayItem
  | FileChangeDisplayItem
  | ToolCallDisplayItem
  | HookDisplayItem
  | ReasoningDisplayItem
  | ContextCompactionDisplayItem
  | TaskProgressDisplayItem
  | AgentDisplayItem
  | ApprovalResultDisplayItem
  | ReviewResultDisplayItem;

export type DisplayBlock =
  | {
      type: "item";
      item: DisplayItem;
    }
  | {
      type: "activityGroup";
      id: string;
      turnId: string;
      summary: string;
      items: DisplayItem[];
    };
