import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
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
  | "wait"
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
  readonly id: string;
  readonly kind: MessageStreamItemKind;
  readonly role: MessageStreamRole;
  readonly turnId?: string;
  readonly sourceItemId?: string;
  readonly provenance?: MessageStreamItemProvenance;
  readonly executionState?: ExecutionState;
}

export type MessageStreamPrimaryTarget =
  | {
      readonly kind: "path";
      readonly path: string;
    }
  | {
      readonly kind: "value";
      readonly value: string;
    };

export interface MessageStreamDiagnosticSection {
  readonly title: string;
  readonly body: string;
}

interface MessageStreamWebSearchDetails {
  readonly action?: string;
  readonly query?: string;
  readonly url?: string;
  readonly pattern?: string;
}

interface MessageStreamImageGenerationDetails {
  readonly savedPath?: string;
  readonly revisedPrompt?: string | null;
  readonly result?: string;
}

interface MessageStreamHookRunDetails {
  readonly eventName: string;
  readonly statusMessage?: string;
  readonly durationMs?: string;
  readonly entries: readonly { readonly kind: string; readonly text: string }[];
}

export interface MessageStreamAuditFact {
  readonly key: string;
  readonly value: string;
}

export interface MessageStreamNoticeSection {
  readonly title?: string;
  readonly auditFacts?: readonly MessageStreamAuditFact[];
  readonly body?: string;
}

interface MessageStreamApprovalResultDetails {
  readonly status: string;
  readonly scope: "session" | "turn";
  readonly request: string;
  readonly auditFacts: readonly MessageStreamAuditFact[];
}

export interface MessageStreamUserInputQuestionResult {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly answer?: string;
}

interface MessageStreamReviewResultDetails {
  readonly auditFacts: readonly MessageStreamAuditFact[];
}

export type CommandMessageStreamTarget =
  | {
      readonly kind: "read";
      readonly path?: string;
      readonly name: string;
    }
  | {
      readonly kind: "search";
      readonly query?: string;
      readonly path?: string;
    }
  | {
      readonly kind: "listFiles";
      readonly path?: string;
    }
  | {
      readonly kind: "command";
      readonly commandLine: string;
    };

interface MessageStreamMessageBase extends MessageStreamBase {
  readonly kind: "message";
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly clientId?: string;
  readonly copyText?: string;
  readonly referencedThread?: ReferencedThreadMetadata;
  readonly mentionedFiles?: readonly MessageStreamFileMention[];
}

interface UserMessageStreamItem extends MessageStreamMessageBase {
  readonly messageKind: "user";
  readonly role: "user";
  readonly messageState?: never;
}

interface AssistantResponseMessageStreamItem extends MessageStreamMessageBase {
  readonly messageKind: "assistantResponse";
  readonly role: "assistant";
  readonly messageState: MessageState;
}

interface ProposedPlanMessageStreamItem extends MessageStreamMessageBase {
  readonly messageKind: "proposedPlan";
  readonly role: "assistant";
  readonly messageState: MessageState;
}

export type MessageStreamMessageItem = UserMessageStreamItem | AssistantResponseMessageStreamItem | ProposedPlanMessageStreamItem;

export interface MessageStreamFileMention {
  readonly name: string;
  readonly path: string;
}

interface SystemMessageStreamItem extends MessageStreamBase {
  readonly kind: "system";
  readonly role: "system";
  readonly text: string;
  readonly noticeSections?: readonly MessageStreamNoticeSection[];
}

export interface GoalMessageStreamItem extends MessageStreamBase {
  readonly kind: "goal";
  readonly role: "tool";
  readonly text: string;
  readonly action: string;
  readonly objective?: string;
}

interface UserInputResultMessageStreamItem extends MessageStreamBase {
  readonly kind: "userInputResult";
  readonly role: "tool";
  readonly text: string;
  readonly questions: readonly MessageStreamUserInputQuestionResult[];
}

export interface ApprovalResultMessageStreamItem extends MessageStreamBase {
  readonly kind: "approvalResult";
  readonly role: "tool";
  readonly text: string;
  readonly approval: MessageStreamApprovalResultDetails;
}

export interface ReviewResultMessageStreamItem extends MessageStreamBase {
  readonly kind: "reviewResult";
  readonly role: "tool";
  readonly text: string;
  readonly review?: MessageStreamReviewResultDetails;
}

export interface CommandMessageStreamItem extends MessageStreamBase {
  readonly kind: "command";
  readonly role: "tool";
  readonly commandAction: "read" | "search" | "listFiles" | "command";
  readonly commandTarget: CommandMessageStreamTarget;
  readonly command: string;
  readonly cwd: string;
  readonly status: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly output?: string;
}

export interface MessageStreamFileChange {
  readonly kind: string;
  readonly path: string;
  readonly diff: string;
}

export interface FileChangeMessageStreamItem extends MessageStreamBase {
  readonly kind: "fileChange";
  readonly role: "tool";
  readonly status: string;
  readonly changes: readonly MessageStreamFileChange[];
  readonly output?: string;
}

interface ToolMessageStreamBase extends MessageStreamBase {
  readonly role: "tool";
  readonly text?: string;
  readonly toolName?: string;
  readonly primaryTarget?: MessageStreamPrimaryTarget;
  readonly operation?: string;
  readonly failureReason?: string;
  readonly status?: string;
  readonly output?: string;
}

export interface ToolCallMessageStreamItem extends ToolMessageStreamBase {
  readonly kind: "tool";
  readonly diagnostics?: readonly MessageStreamDiagnosticSection[];
  readonly webSearch?: MessageStreamWebSearchDetails;
  readonly imageGeneration?: MessageStreamImageGenerationDetails;
}

export interface HookMessageStreamItem extends ToolMessageStreamBase {
  readonly kind: "hook";
  readonly hookRun?: MessageStreamHookRunDetails;
}

export interface ReasoningMessageStreamItem extends ToolMessageStreamBase {
  readonly kind: "reasoning";
  readonly text: string;
}

interface ContextCompactionMessageStreamItem extends MessageStreamBase {
  readonly kind: "contextCompaction";
  readonly role: "tool";
}

interface WaitMessageStreamItem extends MessageStreamBase {
  readonly kind: "wait";
  readonly role: "tool";
  readonly text: string;
}

interface TaskProgressStep {
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

export interface TaskProgressMessageStreamItem extends MessageStreamBase {
  readonly kind: "taskProgress";
  readonly role: "tool";
  readonly text?: string;
  readonly explanation: string | null;
  readonly steps: readonly TaskProgressStep[];
  readonly status: string;
}

export interface AgentStateSummary {
  readonly threadId: string;
  readonly status: string;
  readonly message: string | null;
}

export interface AgentRunSummaryAgent {
  readonly threadId: string;
  readonly status: string;
  readonly messagePreview: string | null;
}

export interface AgentMessageStreamItem extends MessageStreamBase {
  readonly kind: "agent";
  readonly role: "tool";
  readonly text?: string;
  readonly tool: string;
  readonly status: string;
  readonly senderThreadId: string;
  readonly receiverThreadIds: readonly string[];
  readonly prompt: string | null;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly agents: readonly AgentStateSummary[];
}

export interface AgentRunSummary {
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly agents: readonly AgentRunSummaryAgent[];
  readonly additionalAgents: number;
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
  | WaitMessageStreamItem
  | ContextCompactionMessageStreamItem
  | TaskProgressMessageStreamItem
  | AgentMessageStreamItem
  | ApprovalResultMessageStreamItem
  | ReviewResultMessageStreamItem;
