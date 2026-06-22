import type { PendingApproval, PendingMcpElicitation, PendingUserInput } from "../../../../domain/pending-requests/model";
import { hasPendingRequests, pendingRequestCountsFromQueues } from "../../../../domain/pending-requests/aggregate";

export function pendingRequestsSignature(
  approvals: readonly PendingApproval[],
  inputs: readonly PendingUserInput[],
  mcpElicitations: readonly PendingMcpElicitation[],
  drafts: ReadonlyMap<string, string>,
  mcpDrafts: ReadonlyMap<string, string>,
): string {
  if (
    !hasPendingRequests(pendingRequestCountsFromQueues({ approvals, pendingUserInputs: inputs, pendingMcpElicitations: mcpElicitations }))
  ) {
    return "";
  }
  return JSON.stringify({
    approvals: approvals.map((approval) => ({ id: approval.requestId, kind: approval.kind })),
    inputs: inputs.map((input) => ({
      id: input.requestId,
      questions: input.params.questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.question,
        options: question.options?.map((option) => option.label) ?? null,
      })),
    })),
    mcpElicitations: mcpElicitations.map((elicitation) => ({
      id: elicitation.requestId,
      mode: elicitation.params.mode,
      serverName: elicitation.params.serverName,
      message: elicitation.params.message,
      fields:
        elicitation.params.mode === "form"
          ? elicitation.params.fields.map((field) => ({
              id: field.id,
              type: field.type,
              title: field.title,
              options: "options" in field ? field.options.map((option) => option.value) : null,
            }))
          : [],
    })),
    drafts: Array.from(drafts.entries()).sort(([left], [right]) => left.localeCompare(right)),
    mcpDrafts: Array.from(mcpDrafts.entries()).sort(([left], [right]) => left.localeCompare(right)),
  });
}

export function pendingRequestFocusSignature(
  approvals: readonly PendingApproval[],
  inputs: readonly PendingUserInput[],
  mcpElicitations: readonly PendingMcpElicitation[],
): string {
  if (
    !hasPendingRequests(pendingRequestCountsFromQueues({ approvals, pendingUserInputs: inputs, pendingMcpElicitations: mcpElicitations }))
  ) {
    return "";
  }
  return JSON.stringify({
    approvals: approvals.map((approval) => ({ id: approval.requestId, kind: approval.kind })),
    inputs: inputs.map((input) => ({ id: input.requestId })),
    mcpElicitations: mcpElicitations.map((elicitation) => ({ id: elicitation.requestId, mode: elicitation.params.mode })),
  });
}
