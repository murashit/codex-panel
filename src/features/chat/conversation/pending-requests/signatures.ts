import type { PendingApproval } from "../../protocol/server-requests/approval";
import type { PendingUserInput } from "../../protocol/server-requests/user-input";

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
