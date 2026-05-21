import type { RequestId } from "../generated/app-server/RequestId";
import {
  approvalActionKind,
  approvalDetails,
  approvalResultSummary,
  approvalTitle,
  type ApprovalAction,
  type PendingApproval,
} from "../approvals/model";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import type { PendingUserInput } from "../user-input/model";

export function userInputDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}`;
}

export function userInputOtherDraftKey(requestId: RequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}:other`;
}

export function pendingRequestsSignature(approvals: PendingApproval[], inputs: PendingUserInput[], drafts: Map<string, string>): string {
  if (approvals.length === 0 && inputs.length === 0) return "";
  return JSON.stringify({
    approvals: approvals.map((approval) => ({ id: approval.requestId, method: approval.method })),
    inputs: inputs.map((input) => ({
      id: input.requestId,
      questions: input.params.questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.question,
        options: question.options?.map((option) => option.label) ?? null,
      })),
    })),
    drafts: Array.from(drafts.entries()).sort(([left], [right]) => left.localeCompare(right)),
  });
}

export function clearUserInputDrafts(drafts: Map<string, string>, input: PendingUserInput): void {
  for (const question of input.params.questions) {
    drafts.delete(userInputDraftKey(input.requestId, question.id));
    drafts.delete(userInputOtherDraftKey(input.requestId, question.id));
  }
}

export function createApprovalResultItem(approval: PendingApproval, action: ApprovalAction): DisplayItem {
  const status = approvalResultStatus(action);
  const kind = approvalActionKind(action);
  const scope = kind === "accept-session" ? "session" : "turn";
  return {
    id: `approval-${String(approval.requestId)}`,
    kind: "approvalResult",
    role: "tool",
    text: approvalResultText(approval, action),
    turnId: approvalTurnId(approval),
    markdown: false,
    state: kind === "accept" || kind === "accept-session" ? "completed" : "failed",
    details: [
      {
        title: "Approval",
        rows: [
          { key: "status", value: status },
          { key: "scope", value: scope },
          { key: "request", value: approvalTitle(approval) },
          ...approvalDetails(approval),
        ],
      },
    ],
  };
}

export function createUserInputResultItem(
  input: PendingUserInput,
  answers: Record<string, string>,
  status: "submitted" | "cancelled",
): DisplayItem {
  const questionCount = input.params.questions.length;
  const label = questionCount === 1 ? "1 question" : `${questionCount} questions`;
  const details: DisplayDetailSection[] = input.params.questions.map((question) => ({
    title: question.header || question.id,
    rows: [
      { key: "question", value: question.question },
      ...(status === "submitted" ? [{ key: "answer", value: answers[question.id] ?? "" }] : []),
    ],
  }));
  return {
    id: `user-input-${status}-${String(input.requestId)}`,
    kind: "userInputResult",
    role: "tool",
    text: status === "submitted" ? `Input submitted for ${label}.` : `Input request cancelled for ${label}.`,
    turnId: input.params.turnId,
    markdown: false,
    state: status === "submitted" ? "completed" : "failed",
    details,
  };
}

function approvalResultText(approval: PendingApproval, action: ApprovalAction): string {
  return `${approvalResultPrefix(action)}: ${approvalResultSummary(approval)}`;
}

function approvalResultPrefix(action: ApprovalAction): string {
  const kind = approvalActionKind(action);
  if (kind === "accept") return "Allowed";
  if (kind === "accept-session") return "Allowed for this session";
  if (kind === "cancel") return "Cancelled";
  return "Denied";
}

function approvalResultStatus(action: ApprovalAction): string {
  const kind = approvalActionKind(action);
  if (kind === "accept") return "allowed";
  if (kind === "accept-session") return "allowed for session";
  if (kind === "cancel") return "cancelled";
  return "denied";
}

function approvalTurnId(approval: PendingApproval): string | undefined {
  const params = approval.params as { turnId?: unknown };
  return typeof params.turnId === "string" ? params.turnId : undefined;
}
