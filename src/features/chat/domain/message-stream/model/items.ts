import type { ReferencedThreadMetadata } from "../../../../../domain/threads/reference";
import type { MessageStreamItemProvenance } from "./provenance";

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
  turnId?: string;
  sourceItemId?: string;
  provenance?: MessageStreamItemProvenance;
  executionState?: ExecutionState;
}

export type MessageStreamPrimaryTarget =
  | {
      kind: "path";
      path: string;
    }
  | {
      kind: "value";
      value: string;
    };

interface MessageStreamToolCallDetails {
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
}

interface MessageStreamWebSearchDetails {
  action?: string;
  query?: string;
  url?: string;
  pattern?: string;
}

interface MessageStreamImageGenerationDetails {
  savedPath?: string;
  revisedPrompt?: string | null;
  result?: string;
}

interface MessageStreamHookRunDetails {
  eventName: string;
  statusMessage?: string;
  durationMs?: string;
  entries: readonly { kind: string; text: string }[];
}

export interface MessageStreamAuditFact {
  key: string;
  value: string;
}

export interface MessageStreamNoticeSection {
  title?: string;
  auditFacts?: MessageStreamAuditFact[];
  body?: string;
}

interface MessageStreamApprovalResultDetails {
  status: string;
  scope: "session" | "turn";
  request: string;
  auditFacts: MessageStreamAuditFact[];
}

export interface MessageStreamUserInputQuestionResult {
  id: string;
  header: string;
  question: string;
  answer?: string;
}

interface MessageStreamReviewResultDetails {
  auditFacts: MessageStreamAuditFact[];
}

export type CommandMessageStreamTarget =
  | {
      kind: "read";
      path?: string;
      name: string;
    }
  | {
      kind: "search";
      query?: string;
      path?: string;
    }
  | {
      kind: "listFiles";
      path?: string;
    }
  | {
      kind: "command";
      commandLine: string;
    };

interface MessageStreamMessageBase extends MessageStreamBase {
  kind: "message";
  role: "user" | "assistant";
  text: string;
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
  text: string;
  noticeSections?: MessageStreamNoticeSection[];
}

export interface GoalMessageStreamItem extends MessageStreamBase {
  kind: "goal";
  role: "tool";
  text: string;
  action: string;
  objective?: string;
}

interface UserInputResultMessageStreamItem extends MessageStreamBase {
  kind: "userInputResult";
  role: "tool";
  text: string;
  questions: MessageStreamUserInputQuestionResult[];
}

export interface ApprovalResultMessageStreamItem extends MessageStreamBase {
  kind: "approvalResult";
  role: "tool";
  text: string;
  approval: MessageStreamApprovalResultDetails;
}

export interface ReviewResultMessageStreamItem extends MessageStreamBase {
  kind: "reviewResult";
  role: "tool";
  text: string;
  review?: MessageStreamReviewResultDetails;
}

export interface CommandMessageStreamItem extends MessageStreamBase {
  kind: "command";
  role: "tool";
  commandAction: "read" | "search" | "listFiles" | "command";
  commandTarget: CommandMessageStreamTarget;
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
  text?: string;
  toolName?: string;
  primaryTarget?: MessageStreamPrimaryTarget;
  operation?: string;
  failureReason?: string;
  status?: string;
  output?: string;
}

export interface ToolCallMessageStreamItem extends ToolMessageStreamBase {
  kind: "tool";
  toolCall?: MessageStreamToolCallDetails;
  webSearch?: MessageStreamWebSearchDetails;
  imageGeneration?: MessageStreamImageGenerationDetails;
}

export interface HookMessageStreamItem extends ToolMessageStreamBase {
  kind: "hook";
  hookRun?: MessageStreamHookRunDetails;
}

export interface ReasoningMessageStreamItem extends ToolMessageStreamBase {
  kind: "reasoning";
  text: string;
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
  text?: string;
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
  text?: string;
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
