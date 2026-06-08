import {
  approvalActionKind,
  approvalDetails,
  approvalResultSummary,
  approvalTitle,
  type ApprovalAction,
  type PendingApproval,
} from "./approval";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import { definedProp } from "../../../utils";
import type { PendingUserInput } from "./user-input";

export function pendingRequestsSignature(
  approvals: readonly PendingApproval[],
  inputs: readonly PendingUserInput[],
  drafts: ReadonlyMap<string, string>,
): string {
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

export function pendingRequestFocusSignature(approvals: readonly PendingApproval[], inputs: readonly PendingUserInput[]): string {
  if (approvals.length === 0 && inputs.length === 0) return "";
  return JSON.stringify({
    approvals: approvals.map((approval) => ({ id: approval.requestId, method: approval.method })),
    inputs: inputs.map((input) => ({ id: input.requestId, method: input.method })),
  });
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
    ...definedProp("turnId", approvalTurnId(approval)),
    executionState: kind === "accept" || kind === "accept-session" ? "completed" : "failed",
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
  const label = questionCount === 1 ? "1 question" : `${String(questionCount)} questions`;
  const details: DisplayDetailSection[] = input.params.questions.map((question) => ({
    title: `Question: ${question.header || question.id}`,
    rows: [
      { key: "Prompt", value: question.question },
      ...(status === "submitted" ? [{ key: "Answer", value: answers[question.id] ?? "" }] : []),
    ],
  }));
  return {
    id: `user-input-${status}-${String(input.requestId)}`,
    kind: "userInputResult",
    role: "tool",
    text: status === "submitted" ? `Input submitted for ${label}.` : `Input request cancelled for ${label}.`,
    ...definedProp("turnId", input.params.turnId),
    executionState: status === "submitted" ? "completed" : "failed",
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
