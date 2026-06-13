import type { ReferencedThreadMetadata } from "../../../domain/threads/reference";

export type MessageStreamItemKind =
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
type MessageStreamRole = "user" | "assistant" | "system" | "tool";
export type ExecutionState = "running" | "completed" | "failed" | null;
type MessageState = "streaming" | "completed";

interface MessageStreamBase {
  id: string;
  kind: MessageStreamItemKind;
  role: MessageStreamRole;
  text: string;
  turnId?: string;
  sourceItemId?: string;
  executionState?: ExecutionState;
}

export interface MessageStreamDetailMetaRow {
  key: string;
  value: string;
}

export interface MessageStreamDetailSection {
  title?: string;
  body?: string;
  rows?: MessageStreamDetailMetaRow[];
}

interface MessageStreamMessageBase extends MessageStreamBase {
  kind: "message";
  role: "user" | "assistant";
  clientId?: string;
  copyText?: string;
  referencedThread?: ReferencedThreadMetadata;
  mentionedFiles?: MessageStreamFileMention[];
}

interface UserMessageStreamItem extends MessageStreamMessageBase {
  messageKind: "user";
  role: "user";
  messageState?: never;
}

interface AssistantResponseMessageStreamItem extends MessageStreamMessageBase {
  messageKind: "assistantResponse";
  role: "assistant";
  messageState: MessageState;
}

interface ProposedPlanMessageStreamItem extends MessageStreamMessageBase {
  messageKind: "proposedPlan";
  role: "assistant";
  messageState: MessageState;
}

export type AssistantAuthoredMessageStreamItem = AssistantResponseMessageStreamItem | ProposedPlanMessageStreamItem;

export type MessageStreamMessageItem = UserMessageStreamItem | AssistantAuthoredMessageStreamItem;

export interface MessageStreamFileMention {
  name: string;
  path: string;
}

interface SystemMessageStreamItem extends MessageStreamBase {
  kind: "system";
  role: "system";
  details?: MessageStreamDetailSection[];
}

export interface GoalMessageStreamItem extends MessageStreamBase {
  kind: "goal";
  role: "tool";
  objective?: string;
  details?: MessageStreamDetailSection[];
}

interface UserInputResultMessageStreamItem extends MessageStreamBase {
  kind: "userInputResult";
  role: "tool";
  details?: MessageStreamDetailSection[];
}

export interface ApprovalResultMessageStreamItem extends MessageStreamBase {
  kind: "approvalResult";
  role: "tool";
  details?: MessageStreamDetailSection[];
}

export interface ReviewResultMessageStreamItem extends MessageStreamBase {
  kind: "reviewResult";
  role: "tool";
  details?: MessageStreamDetailSection[];
}

export interface CommandMessageStreamItem extends MessageStreamBase {
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

export interface MessageStreamFileChange {
  kind: string;
  path: string;
  diff: string;
}

export interface FileChangeMessageStreamItem extends MessageStreamBase {
  kind: "fileChange";
  role: "tool";
  status: string;
  changes: MessageStreamFileChange[];
  output?: string;
}

interface ToolMessageStreamBase extends MessageStreamBase {
  role: "tool";
  activityKind?: "userSteered";
  toolLabel?: string;
  summaryPath?: boolean;
  status?: string;
  output?: string;
  details?: MessageStreamDetailSection[];
}

export interface ToolCallMessageStreamItem extends ToolMessageStreamBase {
  kind: "tool";
}

export interface HookMessageStreamItem extends ToolMessageStreamBase {
  kind: "hook";
}

export interface ReasoningMessageStreamItem extends ToolMessageStreamBase {
  kind: "reasoning";
}

export interface ContextCompactionMessageStreamItem extends MessageStreamBase {
  kind: "contextCompaction";
  role: "tool";
}

interface TaskProgressStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

export interface TaskProgressMessageStreamItem extends MessageStreamBase {
  kind: "taskProgress";
  role: "tool";
  explanation: string | null;
  steps: TaskProgressStep[];
  status: string;
}

export interface AgentStateSummary {
  threadId: string;
  status: string;
  message: string | null;
}

export interface AgentRunSummaryAgent {
  threadId: string;
  status: string;
  messagePreview: string | null;
}

export interface AgentMessageStreamItem extends MessageStreamBase {
  kind: "agent";
  role: "tool";
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agents: AgentStateSummary[];
}

export interface AgentRunSummary {
  running: number;
  completed: number;
  failed: number;
  agents: AgentRunSummaryAgent[];
  additionalAgents: number;
}

export type MessageStreamItem =
  | MessageStreamMessageItem
  | SystemMessageStreamItem
  | GoalMessageStreamItem
  | UserInputResultMessageStreamItem
  | CommandMessageStreamItem
  | FileChangeMessageStreamItem
  | ToolCallMessageStreamItem
  | HookMessageStreamItem
  | ReasoningMessageStreamItem
  | ContextCompactionMessageStreamItem
  | TaskProgressMessageStreamItem
  | AgentMessageStreamItem
  | ApprovalResultMessageStreamItem
  | ReviewResultMessageStreamItem;
