import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import type { ThreadStreamItemProvenance } from "./provenance";

export type ThreadStreamItemKind =
  | "dialogue"
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
type ThreadStreamRole = "user" | "assistant" | "system" | "tool";
export type ExecutionState = "running" | "completed" | "failed" | null;
type DialogueState = "streaming" | "completed";

interface ThreadStreamBase {
  readonly id: string;
  readonly kind: ThreadStreamItemKind;
  readonly role: ThreadStreamRole;
  readonly turnId?: string;
  readonly sourceItemId?: string;
  readonly provenance?: ThreadStreamItemProvenance;
  readonly executionState?: ExecutionState;
}

export type ThreadStreamPrimaryTarget =
  | {
      readonly kind: "path";
      readonly path: string;
    }
  | {
      readonly kind: "value";
      readonly value: string;
    };

export interface ThreadStreamDiagnosticSection {
  readonly title: string;
  readonly body: string;
}

interface ThreadStreamWebSearchDetails {
  readonly action?: string;
  readonly query?: string;
  readonly url?: string;
  readonly pattern?: string;
}

interface ThreadStreamImageGenerationDetails {
  readonly savedPath?: string;
  readonly revisedPrompt?: string | null;
  readonly result?: string;
}

interface ThreadStreamHookRunDetails {
  readonly eventName: string;
  readonly statusMessage?: string;
  readonly durationMs?: string;
  readonly entries: readonly { readonly kind: string; readonly text: string }[];
}

export interface ThreadStreamAuditFact {
  readonly key: string;
  readonly value: string;
}

export interface ThreadStreamNoticeSection {
  readonly title?: string;
  readonly auditFacts?: readonly ThreadStreamAuditFact[];
  readonly body?: string;
}

interface ThreadStreamApprovalResultDetails {
  readonly status: string;
  readonly scope: "session" | "turn";
  readonly request: string;
  readonly auditFacts: readonly ThreadStreamAuditFact[];
}

export interface ThreadStreamUserInputQuestionResult {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly answer?: string;
}

interface ThreadStreamReviewResultDetails {
  readonly auditFacts: readonly ThreadStreamAuditFact[];
}

export type CommandThreadStreamTarget =
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

interface ThreadStreamDialogueBase extends ThreadStreamBase {
  readonly kind: "dialogue";
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly clientId?: string;
  readonly copyText?: string;
  readonly referencedThread?: ReferencedThreadMetadata;
  readonly mentionedFiles?: readonly ThreadStreamFileMention[];
}

interface UserThreadStreamDialogueItem extends ThreadStreamDialogueBase {
  readonly dialogueKind: "user";
  readonly role: "user";
  readonly dialogueState?: never;
}

interface AssistantResponseThreadStreamDialogueItem extends ThreadStreamDialogueBase {
  readonly dialogueKind: "assistantResponse";
  readonly role: "assistant";
  readonly dialogueState: DialogueState;
}

interface ProposedPlanThreadStreamDialogueItem extends ThreadStreamDialogueBase {
  readonly dialogueKind: "proposedPlan";
  readonly role: "assistant";
  readonly dialogueState: DialogueState;
}

export type ThreadStreamDialogueItem =
  | UserThreadStreamDialogueItem
  | AssistantResponseThreadStreamDialogueItem
  | ProposedPlanThreadStreamDialogueItem;

export interface ThreadStreamFileMention {
  readonly name: string;
  readonly path: string;
}

interface SystemThreadStreamItem extends ThreadStreamBase {
  readonly kind: "system";
  readonly role: "system";
  readonly text: string;
  readonly noticeSections?: readonly ThreadStreamNoticeSection[];
}

export interface GoalThreadStreamItem extends ThreadStreamBase {
  readonly kind: "goal";
  readonly role: "tool";
  readonly text: string;
  readonly action: string;
  readonly objective?: string;
}

interface UserInputResultThreadStreamItem extends ThreadStreamBase {
  readonly kind: "userInputResult";
  readonly role: "tool";
  readonly text: string;
  readonly questions: readonly ThreadStreamUserInputQuestionResult[];
}

export interface ApprovalResultThreadStreamItem extends ThreadStreamBase {
  readonly kind: "approvalResult";
  readonly role: "tool";
  readonly text: string;
  readonly approval: ThreadStreamApprovalResultDetails;
}

export interface ReviewResultThreadStreamItem extends ThreadStreamBase {
  readonly kind: "reviewResult";
  readonly role: "tool";
  readonly text: string;
  readonly review?: ThreadStreamReviewResultDetails;
}

export interface CommandThreadStreamItem extends ThreadStreamBase {
  readonly kind: "command";
  readonly role: "tool";
  readonly commandAction: "read" | "search" | "listFiles" | "command";
  readonly commandTarget: CommandThreadStreamTarget;
  readonly command: string;
  readonly cwd: string;
  readonly status: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly output?: string;
}

export interface ThreadStreamFileChange {
  readonly kind: string;
  readonly path: string;
  readonly diff: string;
}

export interface FileChangeThreadStreamItem extends ThreadStreamBase {
  readonly kind: "fileChange";
  readonly role: "tool";
  readonly status: string;
  readonly changes: readonly ThreadStreamFileChange[];
  readonly output?: string;
}

interface ToolThreadStreamBase extends ThreadStreamBase {
  readonly role: "tool";
  readonly text?: string;
  readonly toolName?: string;
  readonly primaryTarget?: ThreadStreamPrimaryTarget;
  readonly operation?: string;
  readonly failureReason?: string;
  readonly status?: string;
  readonly output?: string;
}

export interface ToolCallThreadStreamItem extends ToolThreadStreamBase {
  readonly kind: "tool";
  readonly diagnostics?: readonly ThreadStreamDiagnosticSection[];
  readonly webSearch?: ThreadStreamWebSearchDetails;
  readonly imageGeneration?: ThreadStreamImageGenerationDetails;
}

export interface HookThreadStreamItem extends ToolThreadStreamBase {
  readonly kind: "hook";
  readonly hookRun?: ThreadStreamHookRunDetails;
}

export interface ReasoningThreadStreamItem extends ToolThreadStreamBase {
  readonly kind: "reasoning";
  readonly text: string;
}

interface ContextCompactionThreadStreamItem extends ThreadStreamBase {
  readonly kind: "contextCompaction";
  readonly role: "tool";
}

interface WaitThreadStreamItem extends ThreadStreamBase {
  readonly kind: "wait";
  readonly role: "tool";
  readonly text: string;
}

interface TaskProgressStep {
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

export interface TaskProgressThreadStreamItem extends ThreadStreamBase {
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
  readonly executionState: ExecutionState;
  readonly message: string | null;
}

export interface AgentRunSummaryAgent {
  readonly threadId: string;
  readonly status: string;
  readonly messagePreview: string | null;
}

export interface AgentThreadStreamItem extends ThreadStreamBase {
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

export type ThreadStreamItem =
  | ThreadStreamDialogueItem
  | SystemThreadStreamItem
  | GoalThreadStreamItem
  | UserInputResultThreadStreamItem
  | CommandThreadStreamItem
  | FileChangeThreadStreamItem
  | ToolCallThreadStreamItem
  | HookThreadStreamItem
  | ReasoningThreadStreamItem
  | WaitThreadStreamItem
  | ContextCompactionThreadStreamItem
  | TaskProgressThreadStreamItem
  | AgentThreadStreamItem
  | ApprovalResultThreadStreamItem
  | ReviewResultThreadStreamItem;
